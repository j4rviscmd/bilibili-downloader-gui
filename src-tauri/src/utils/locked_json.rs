//! Multi-process safe JSON file store utilities (issue #560).
//!
//! Every persistent JSON file this app writes (`history.json`,
//! `settings.json`, `login_state.json`, `window-state.json`) can be accessed
//! by multiple app processes at once (running two app instances side by side
//! is a supported way to download in parallel). The previous tauri-plugin-store
//! backend only serialized accesses *within* one process — its `save()` is a
//! plain `fs::write` even in the latest release, and its in-memory cache
//! never learns about writes from other processes.
//!
//! This module instead provides read-modify-write and read-only access where
//! correctness does not depend on the caller remembering any discipline:
//!
//! - **Inter-process exclusion** via an advisory lock file (`{path}.lock`,
//!   `fs2`: flock on Unix, LockFileEx on Windows). The lock is acquired and
//!   released inside these functions, so callers cannot forget it.
//! - **Atomic writes**: serialize to a temp file, fsync, then rename over the
//!   target. A crash mid-write leaves the previous file intact.
//! - **No cache**: every read hits the disk, so data written by another
//!   process is always visible.
//! - **Corruption quarantine**: if the file cannot be parsed, it is moved
//!   aside to `{stem}.corrupt-{timestamp}{ext}` and the caller sees the
//!   default value instead of an error, so one bad write never bricks the
//!   app or silently wipes the file on the next save.
//!
//! CONSTRAINT: do not nest `with_json_mut` calls on the same path (inside a
//! closure, calling `with_json_mut` again for the same file deadlocks until
//! the 10s timeout). The lock is held for the whole closure.

use fs2::FileExt;
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How long `with_json*` waits to acquire the lock before failing.
const LOCK_TIMEOUT: Duration = Duration::from_secs(10);
/// Poll interval while waiting for the lock (see `acquire_lock`).
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Errors returned by the locked JSON helpers.
#[derive(Debug)]
pub enum LockedJsonError {
    /// The lock could not be acquired within `LOCK_TIMEOUT`.
    LockTimeout(PathBuf),
    /// An I/O error occurred (read, temp write, rename, ...).
    Io(std::io::Error),
    /// The mutation closure returned an error; the file is left untouched.
    Mutation(String),
    /// Serialization or deserialization failed even after quarantine handling.
    Serde(String),
}

impl std::fmt::Display for LockedJsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockedJsonError::LockTimeout(p) => {
                write!(f, "timed out acquiring lock for {}", p.display())
            }
            LockedJsonError::Io(e) => write!(f, "io error: {}", e),
            LockedJsonError::Mutation(m) => write!(f, "mutation failed: {}", m),
            LockedJsonError::Serde(m) => write!(f, "json error: {}", m),
        }
    }
}

impl std::error::Error for LockedJsonError {}

impl From<std::io::Error> for LockedJsonError {
    fn from(e: std::io::Error) -> Self {
        LockedJsonError::Io(e)
    }
}

/// Acquires the exclusive lock next to `path`, blocking up to `LOCK_TIMEOUT`.
///
/// Uses `try_lock` polling instead of a blocking `lock_exclusive` so we can
/// enforce a timeout (a stuck holder must not hang the caller forever).
fn acquire_lock(path: &Path) -> Result<File, LockedJsonError> {
    acquire_lock_with_timeout(path, LOCK_TIMEOUT)
}

/// Timeout-parameterized core of [`acquire_lock`] (test seam).
fn acquire_lock_with_timeout(path: &Path, timeout: Duration) -> Result<File, LockedJsonError> {
    let lock_path = lock_path_for(path);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)?;
    let deadline = Instant::now() + timeout;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(file),
            Err(_) => {
                if Instant::now() >= deadline {
                    return Err(LockedJsonError::LockTimeout(lock_path));
                }
                std::thread::sleep(LOCK_POLL_INTERVAL);
            }
        }
    }
}

/// Returns the sibling lock file path for a data file (`history.json` ->
/// `history.json.lock`).
fn lock_path_for(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    path.with_file_name(name)
}

/// Reads and parses the JSON at `path`.
///
/// - Missing file -> `Ok(None)` (first launch; caller applies defaults).
/// - Unparseable file -> quarantined to `{stem}.corrupt-{ts}{ext}` and treated
///   as missing, so the store self-heals instead of failing forever.
fn read_json_or_quarantine(path: &Path) -> Result<Option<Value>, LockedJsonError> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(v) => Ok(Some(v)),
        Err(_) => {
            let quarantined = quarantine_path_for(path);
            // Why best-effort: if renaming fails (e.g. read-only dir) we still
            // prefer continuing with defaults over hard-failing every launch.
            let _ = fs::rename(path, &quarantined);
            log::warn!(
                "[BE] locked_json: quarantined corrupt file {} -> {}",
                path.display(),
                quarantined.display()
            );
            Ok(None)
        }
    }
}

/// Builds the quarantine target name for a corrupt file.
fn quarantine_path_for(path: &Path) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    path.with_file_name(format!("{}.corrupt-{}{}", stem, ts, ext))
}

/// Atomically writes `value` to `path`: temp file -> fsync -> rename.
fn atomic_write(path: &Path, value: &Value) -> Result<(), LockedJsonError> {
    let mut tmp_path = path.to_path_buf();
    tmp_path.set_extension(format!(
        "{}.tmp",
        path.extension().unwrap_or_default().to_string_lossy()
    ));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|e| LockedJsonError::Serde(e.to_string()))?;
    {
        let mut f = File::create(&tmp_path)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Read-modify-write access to the JSON document at `path`, safe across
/// processes.
///
/// The file is read from disk (never a cache), handed to `f` as `&mut Value`,
/// and — only if `f` returned `Ok` — written back atomically while still
/// holding the lock. If `f` returns `Err` the file is left byte-for-byte
/// untouched.
///
/// A missing file is passed to `f` as `{}`; the closure decides what the
/// default document looks like before mutating it.
pub fn with_json_mut<T>(
    path: &Path,
    f: impl FnOnce(&mut Value) -> Result<T, String>,
) -> Result<T, LockedJsonError> {
    let _lock = acquire_lock(path)?;
    let mut value = read_json_or_quarantine(path)?.unwrap_or_else(|| serde_json::json!({}));
    let result = f(&mut value).map_err(LockedJsonError::Mutation)?;
    atomic_write(path, &value)?;
    Ok(result)
}

/// Read-only access to the JSON document at `path`, safe across processes.
///
/// Always reads the current on-disk state (no cache), under the same lock so a
/// concurrent writer's rename can never be observed half-way. A missing file
/// is passed to `f` as `{}`.
pub fn with_json<T>(
    path: &Path,
    f: impl FnOnce(&Value) -> Result<T, String>,
) -> Result<T, LockedJsonError> {
    let _lock = acquire_lock(path)?;
    let value = read_json_or_quarantine(path)?.unwrap_or_else(|| serde_json::json!({}));
    let result = f(&value).map_err(LockedJsonError::Mutation)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_json(name: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        (dir, path)
    }

    #[test]
    fn mut_writes_and_reads_back() {
        let (_dir, path) = tmp_json("store.json");
        with_json_mut(&path, |v| {
            v["n"] = json!(41);
            Ok(())
        })
        .unwrap();
        let n = with_json(&path, |v| Ok(v["n"].as_i64().unwrap())).unwrap();
        assert_eq!(n, 41);
    }

    #[test]
    fn mut_missing_file_passes_empty_object() {
        let (_dir, path) = tmp_json("fresh.json");
        with_json_mut(&path, |v| {
            assert!(v.as_object().unwrap().is_empty());
            v["seeded"] = json!(true);
            Ok(())
        })
        .unwrap();
        assert!(path.exists());
    }

    #[test]
    fn mutation_error_leaves_file_untouched() {
        let (_dir, path) = tmp_json("keep.json");
        with_json_mut(&path, |v| {
            v["a"] = json!(1);
            Ok(())
        })
        .unwrap();
        let err = with_json_mut(&path, |_v| Err::<(), _>("boom".to_string())).unwrap_err();
        assert!(matches!(err, LockedJsonError::Mutation(m) if m == "boom"));
        let a = with_json(&path, |v| Ok(v["a"].as_i64().unwrap())).unwrap();
        assert_eq!(a, 1);
    }

    #[test]
    fn corrupt_file_is_quarantined_and_treated_as_missing() {
        let (_dir, path) = tmp_json("broken.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let v = with_json(&path, |v| Ok(v.clone())).unwrap();
        assert!(v.as_object().unwrap().is_empty());
        // Quarantine file exists next to the store.
        let mut found = false;
        for entry in std::fs::read_dir(path.parent().unwrap()).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("broken.corrupt-") {
                found = true;
            }
        }
        assert!(found, "expected a broken.corrupt-* file");
    }

    #[test]
    fn sequential_mut_calls_do_not_deadlock() {
        // Same-process nesting is forbidden, but sequential calls must work:
        // the lock is released when with_json_mut returns.
        let (_dir, path) = tmp_json("seq.json");
        for i in 0..5 {
            with_json_mut(&path, |v| {
                v["i"] = json!(i);
                Ok(())
            })
            .unwrap();
        }
        let i = with_json(&path, |v| Ok(v["i"].as_i64().unwrap())).unwrap();
        assert_eq!(i, 4);
    }

    #[test]
    fn concurrent_threads_serialize_read_modify_write() {
        // In-process parallelism must be serialized exactly like
        // multi-process access: 8 threads x 10 increments must never lose an
        // update (the pre-#560 plain read-modify-write loses about half).
        let (_dir, path) = tmp_json("ctr.json");
        with_json_mut(&path, |v| {
            v["count"] = json!(0);
            Ok(())
        })
        .unwrap();
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    for _ in 0..10 {
                        with_json_mut(&path, |v| {
                            v["count"] = json!(v["count"].as_i64().unwrap() + 1);
                            Ok(())
                        })
                        .unwrap();
                    }
                });
            }
        });
        let count = with_json(&path, |v| Ok(v["count"].as_i64().unwrap())).unwrap();
        assert_eq!(count, 80, "no increment may be lost");
    }

    #[test]
    fn lock_file_is_sibling_dot_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let lock = lock_path_for(&path);
        assert_eq!(lock.file_name().unwrap(), "history.json.lock");
        assert_eq!(lock.parent().unwrap(), dir.path());
    }

    #[test]
    fn lock_acquisition_times_out_when_held_by_others() {
        let (_dir, path) = tmp_json("held.json");
        // Simulate another holder (thread or process) on the same lock file.
        let holder = acquire_lock_with_timeout(&path, Duration::from_millis(100)).unwrap();

        let started = Instant::now();
        let err = acquire_lock_with_timeout(&path, Duration::from_millis(150)).unwrap_err();

        assert!(matches!(err, LockedJsonError::LockTimeout(_)));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "timeout must actually bound the wait"
        );
        drop(holder);
        // After release the very next acquisition succeeds again.
        assert!(acquire_lock_with_timeout(&path, Duration::from_millis(100)).is_ok());
    }
}
