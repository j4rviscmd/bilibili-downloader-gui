//! Temp File Cleanup Handler
//!
//! Cleans up orphaned temporary files left from interrupted downloads.
//!
//! Orphan detection (issues #560/#595): downloads hold an exclusive flock on
//! a SIDE CAR lock file (`.lock` sibling) for the download's lifetime —
//! `temp_video_*.m4s` / `temp_audio_*.m4s` on `temp_*.m4s.lock`, output
//! staging `*.part.*` on the final-named `video.mp4.lock`. A sidecar whose
//! flock can be taken has no live owner (the process died before Drop ran),
//! so payload + sidecar are deleted immediately regardless of age. Payload
//! files without a sidecar (left by pre-#595 versions, which locked the
//! payload itself) fall back to probing the payload's own flock.
//! `temp_sub_*` files carry no lock and keep the legacy age rule. Final
//! output files (`video.mp4`) are never touched.

use fs2::FileExt;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::AppHandle;

use crate::handlers::bilibili::lock_sidecar_path;
use crate::utils::paths::get_lib_path;

/// Default age threshold in hours (24 hours = 1 day)
const DEFAULT_MAX_AGE_HOURS: u64 = 24;

/// Result of cleanup operation.
#[derive(Debug, Default, serde::Serialize)]
pub struct CleanupResult {
    /// Number of files successfully deleted
    pub deleted_count: u32,
    /// Number of files that failed to delete
    pub failed_count: u32,
}

/// Cleans up orphaned temp files in the lib directory.
///
/// See [`cleanup_temp_files_in_dir`] for the per-kind rules.
pub fn cleanup_temp_files(app: &AppHandle, max_age_hours: Option<u64>) -> CleanupResult {
    let lib_path = get_lib_path(app);
    cleanup_temp_files_in_dir(&lib_path, max_age_hours)
}

/// Cleans up orphaned temp files in `dir`.
///
/// - `temp_video_*.m4s` / `temp_audio_*.m4s`: liveness is signaled by the
///   exclusive flock on their sidecar `temp_*.m4s.lock` (issue #595); a free
///   sidecar (or, for pre-#595 leftovers without one, a free payload flock)
///   means the owner died, and the file is deleted immediately regardless of
///   age. A live download (another app instance included) holds the sidecar
///   lock and is never touched.
/// - `temp_video_*.m4s.lock` / `temp_audio_*.m4s.lock`: unlocked sidecars
///   (e.g. a crash between payload removal and sidecar removal) are swept.
/// - `temp_sub_*.srt`: no lock is held on these; they keep the legacy
///   "older than max_age" rule.
pub fn cleanup_temp_files_in_dir(dir: &Path, max_age_hours: Option<u64>) -> CleanupResult {
    let max_age = max_age_hours.unwrap_or(DEFAULT_MAX_AGE_HOURS);
    let threshold = SystemTime::now() - Duration::from_secs(max_age * 60 * 60);

    let mut result = CleanupResult::default();

    if !dir.exists() {
        return result;
    }

    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_media_temp_lock(&path) {
                    // An unlocked sidecar is provably dead — a live download
                    // always holds its flock.
                    if is_unlocked_orphan(&path) {
                        delete_file(&path, &mut result);
                    }
                    continue;
                }
                if !is_temp_file(&path) {
                    continue;
                }
                let stale = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .map(|modified| modified < threshold)
                    .unwrap_or(false);
                // Media temps skip the age rule entirely; the sidecar flock
                // is the liveness signal. Subtitle temps fall back to `stale`.
                let removable = if is_media_temp(&path) {
                    media_temp_is_orphan(&path)
                } else {
                    stale
                };
                if removable {
                    delete_file(&path, &mut result);
                }
            }
        }
        Err(e) => {
            log::error!(
                "[BE] cleanup_temp_files: failed to read dir {}: {}",
                dir.display(),
                e
            );
        }
    }

    result
}

/// Removes abandoned `*.part.*` staging files and orphaned sidecar locks
/// from the download output directory (issues #560/#595). A staging file
/// whose sidecar flock is free has no live download behind it (the owning
/// process died before cleanup could run) and is deleted regardless of age.
/// Final files are never touched.
pub async fn cleanup_part_files(app: &AppHandle) -> CleanupResult {
    let settings = crate::handlers::settings::get_settings(app).await.ok();
    let Some(dl_dir) = settings.and_then(|s| s.dl_output_path) else {
        return CleanupResult::default();
    };
    cleanup_part_in_dir(Path::new(&dl_dir))
}

/// Directory-scoped core of [`cleanup_part_files`].
fn cleanup_part_in_dir(dir: &Path) -> CleanupResult {
    let mut result = CleanupResult::default();

    if !dir.exists() {
        return result;
    }

    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_output_sidecar(&path) {
                    // Orphaned output sidecar (`video.mp4.lock`): the claim is
                    // dead. Delete the sidecar only — never the final file,
                    // which may be a finished download (or a user file that
                    // happens to share the name shape).
                    if is_unlocked_orphan(&path) {
                        delete_file(&path, &mut result);
                    }
                } else if is_part_file(&path) && staging_is_orphan(&path) {
                    delete_file(&path, &mut result);
                }
            }
        }
        Err(e) => {
            log::error!(
                "[BE] cleanup_part_files: failed to read dir {}: {}",
                dir.display(),
                e
            );
        }
    }

    result
}

/// Deletes one file, tallying success/failure into `result`.
fn delete_file(path: &Path, result: &mut CleanupResult) {
    match fs::remove_file(path) {
        Ok(()) => {
            log::info!("[BE] cleanup: deleted {:?}", path);
            result.deleted_count += 1;
        }
        Err(e) => {
            log::error!("[BE] cleanup: failed to delete {:?}: {}", path, e);
            result.failed_count += 1;
        }
    }
}

/// Returns true when no live process holds the download's flock on this
/// file. Best-effort: if the file cannot be opened, treat it as locked
/// (leave it alone; some other rule will catch it later).
fn is_unlocked_orphan(path: &Path) -> bool {
    match OpenOptions::new().write(true).read(true).open(path) {
        Ok(file) => file.try_lock_exclusive().is_ok(),
        Err(_) => false,
    }
}

/// Liveness of a media temp: the sidecar flock is authoritative when the
/// sidecar exists; a temp without a sidecar is a pre-#595 leftover (its own
/// flock was the liveness signal) and falls back to probing the payload.
fn media_temp_is_orphan(temp: &Path) -> bool {
    let sidecar = lock_sidecar_path(temp);
    if sidecar.exists() {
        is_unlocked_orphan(&sidecar)
    } else {
        is_unlocked_orphan(temp)
    }
}

/// Liveness of an output staging file: the final-named sidecar flock is
/// authoritative when it exists; staging without a sidecar is a pre-#595
/// leftover and falls back to probing the staging file itself.
fn staging_is_orphan(staging: &Path) -> bool {
    let liveness_lock = final_from_part(staging)
        .map(|final_path| lock_sidecar_path(&final_path))
        .filter(|sidecar| sidecar.exists())
        .unwrap_or_else(|| staging.to_path_buf());
    is_unlocked_orphan(&liveness_lock)
}

/// Pre-#595 inverse of [`part_path`]: `video.part.mp4` -> `video.mp4`.
/// Returns `None` for names not shaped `{stem}.part.{ext}`.
fn final_from_part(part: &Path) -> Option<PathBuf> {
    let name = part.file_name()?.to_str()?;
    let (stem, ext) = name.rsplit_once('.')?;
    let stem = stem.strip_suffix(".part")?;
    Some(part.with_file_name(format!("{stem}.{ext}")))
}

/// `temp_video_*.m4s.lock` / `temp_audio_*.m4s.lock` sidecars.
fn is_media_temp_lock(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    (name.starts_with("temp_video_") || name.starts_with("temp_audio_"))
        && name.ends_with(".m4s.lock")
}

/// Output sidecar locks in the download dir (`video.mp4.lock`). Outputs are
/// always `.mp4` (see `build_output_path`), so the narrow `.mp4.lock` suffix
/// keeps unrelated user `.lock` files out of the sweep.
fn is_output_sidecar(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".mp4.lock") && n.len() > ".mp4.lock".len())
}

/// `temp_video_*` / `temp_audio_*` files (sidecar-flock-protected during
/// downloads).
fn is_media_temp(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    (name.starts_with("temp_video_") || name.starts_with("temp_audio_")) && name.ends_with(".m4s")
}

/// Output staging files written next to the final download
/// (`video.part.mp4`).
fn is_part_file(path: &Path) -> bool {
    match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => {
            // Pattern: "{stem}.part.{ext}" — require the real extension
            // so arbitrary user files containing ".part" in the middle
            // of a stem-less name are not swept.
            name.contains(".part.") && path.extension().is_some()
        }
        None => false,
    }
}

/// Checks if a file is a temp download file.
///
/// Matches files with the following naming conventions:
/// - `temp_video_*.m4s` - Temporary video segments
/// - `temp_audio_*.m4s` - Temporary audio segments
/// - `temp_sub_*.srt` - Temporary subtitle files
///
/// # Arguments
///
/// * `path` - The path to the file to check
///
/// # Returns
///
/// `true` if the file matches the temp file pattern
///
/// # Examples
///
/// Why: private fn; doctests compile as a separate crate and cannot import it, even
/// though the assertions themselves are pure (enforced by the rust-test CI job)
/// ```ignore
/// # use std::path::Path;
/// assert!(is_temp_file(Path::new("temp_video_123.m4s")));
/// assert!(is_temp_file(Path::new("temp_audio_456.m4s")));
/// assert!(is_temp_file(Path::new("temp_sub_789.srt")));
/// assert!(!is_temp_file(Path::new("final_video.mp4")));
/// ```
fn is_temp_file(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => return false,
    };

    let is_video = file_name.starts_with("temp_video_") && file_name.ends_with(".m4s");
    let is_audio = file_name.starts_with("temp_audio_") && file_name.ends_with(".m4s");
    let is_subtitle = file_name.starts_with("temp_sub_") && file_name.ends_with(".srt");

    is_video || is_audio || is_subtitle
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn is_temp_file_matches_temp_prefixes() {
        // Promoted from the ignored doctest: private fn, pure assertions.
        assert!(is_temp_file(Path::new("temp_video_123.m4s")));
        assert!(is_temp_file(Path::new("temp_audio_456.m4s")));
        assert!(is_temp_file(Path::new("temp_sub_789.srt")));
        assert!(!is_temp_file(Path::new("final_video.mp4")));
    }

    #[test]
    fn is_temp_file_rejects_mismatched_pairs() {
        // Prefix without the matching extension (and vice versa) must not match.
        assert!(!is_temp_file(Path::new("temp_video_123.mp4")));
        assert!(!is_temp_file(Path::new("temp_audio_456.srt")));
        assert!(!is_temp_file(Path::new("temp_sub_789.m4s")));
        assert!(!is_temp_file(Path::new("temp_")));
        assert!(!is_temp_file(Path::new("/dir/other.m4s")));
    }

    #[test]
    fn is_part_matches_staging_pattern_only() {
        assert!(is_part_file(Path::new("video.part.mp4")));
        assert!(is_part_file(Path::new("a (1).part.mp4")));
        assert!(!is_part_file(Path::new("video.mp4")));
        assert!(!is_part_file(Path::new("just part")));
    }

    // ---- flock-based orphan rules (fs, tempfile) ----

    #[test]
    fn unlocked_media_temp_is_deleted_regardless_of_age() {
        let dir = tempfile::tempdir().unwrap();
        // Fresh file (well under the 24h threshold) with no lock holder.
        fs::write(dir.path().join("temp_video_dl-1.m4s"), b"x").unwrap();

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(result.deleted_count, 1, "unlocked temp is an orphan");
        assert!(!dir.path().join("temp_video_dl-1.m4s").exists());
    }

    #[test]
    fn locked_media_temp_is_never_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("temp_audio_dl-2.m4s");
        fs::write(&path, b"x").unwrap();
        // Simulate a pre-#595 live download: payload flock held, no sidecar.
        let holder = OpenOptions::new()
            .write(true)
            .read(true)
            .open(&path)
            .unwrap();
        holder.lock_exclusive().unwrap();

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 0,
            "legacy payload-locked temp belongs to a live download"
        );
        assert!(path.exists());
    }

    /// Test helper: create `path` if absent and hold an exclusive flock on
    /// it for the returned guard's lifetime.
    fn hold_flock(path: &Path) -> fs::File {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .open(path)
            .unwrap();
        file.lock_exclusive().unwrap();
        file
    }

    #[test]
    fn sidecar_locked_media_temp_is_never_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("temp_audio_dl-2.m4s");
        fs::write(&path, b"x").unwrap();
        // Simulate a live download (issue #595): flock held on the sidecar.
        let sidecar = lock_sidecar_path(&path);
        let _holder = hold_flock(&sidecar);

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 0,
            "sidecar-locked temp belongs to a live download"
        );
        assert!(path.exists());
    }

    #[test]
    fn unlocked_temp_sidecar_sweeps_payload_and_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("temp_video_dl-4.m4s");
        fs::write(&path, b"x").unwrap();
        // Unlocked sidecar (crashed download): both files go in one pass.
        fs::write(lock_sidecar_path(&path), b"").unwrap();

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 2,
            "dead claim sweeps payload + sidecar"
        );
        assert!(!path.exists());
        assert!(!lock_sidecar_path(&path).exists());
    }

    #[test]
    fn locked_temp_sidecar_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        // Claim held, payload not yet created (download starting).
        let path = dir.path().join("temp_video_dl-5.m4s");
        let sidecar = lock_sidecar_path(&path);
        let _holder = hold_flock(&sidecar);

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 0,
            "locked sidecar means live download"
        );
        assert!(sidecar.exists());
    }

    #[test]
    fn fresh_subtitle_temp_survives_age_rule() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("temp_sub_dl-3.srt"), b"x").unwrap();

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 0,
            "subtitle temps use the age rule only"
        );
        assert!(dir.path().join("temp_sub_dl-3.srt").exists());
    }

    #[test]
    fn unlocked_part_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        // Pre-#595 debris: staging without a sidecar; its own (dead) flock
        // was the liveness signal.
        fs::write(dir.path().join("video.part.mp4"), b"partial").unwrap();

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(result.deleted_count, 1);
        assert!(!dir.path().join("video.part.mp4").exists());
    }

    #[test]
    fn locked_part_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.part.mp4");
        fs::write(&path, b"partial").unwrap();
        // Simulate a pre-#595 live download: payload flock held, no sidecar.
        let holder = OpenOptions::new()
            .write(true)
            .read(true)
            .open(&path)
            .unwrap();
        holder.lock_exclusive().unwrap();

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(result.deleted_count, 0);
        assert!(path.exists());
    }

    #[test]
    fn locked_output_sidecar_keeps_staging() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join("video.part.mp4");
        fs::write(&staging, b"partial").unwrap();
        // Live download (issue #595): flock held on the final-named sidecar.
        let sidecar = dir.path().join("video.mp4.lock");
        let _holder = hold_flock(&sidecar);

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(result.deleted_count, 0, "sidecar-locked staging is live");
        assert!(staging.exists());
        assert!(sidecar.exists());
    }

    #[test]
    fn unlocked_output_sidecar_sweeps_staging_and_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join("video.part.mp4");
        fs::write(&staging, b"partial").unwrap();
        fs::write(dir.path().join("video.mp4.lock"), b"").unwrap();

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(
            result.deleted_count, 2,
            "dead claim sweeps staging + sidecar"
        );
        assert!(!staging.exists());
        assert!(!dir.path().join("video.mp4.lock").exists());
    }

    #[test]
    fn orphan_output_sidecar_deleted_final_untouched() {
        // Crash window between complete()'s rename and sidecar removal: the
        // finished file survives, only the leftover claim goes.
        let dir = tempfile::tempdir().unwrap();
        let final_file = dir.path().join("video.mp4");
        fs::write(&final_file, b"done").unwrap();
        let sidecar = dir.path().join("video.mp4.lock");
        fs::write(&sidecar, b"").unwrap();

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(result.deleted_count, 1, "only the sidecar is swept");
        assert!(!sidecar.exists());
        assert!(final_file.exists(), "final file must never be deleted");
    }

    #[test]
    fn unrelated_lock_files_are_not_swept() {
        // A user's own *.lock file in the download dir that is not shaped
        // like an output sidecar must survive the sweep.
        let dir = tempfile::tempdir().unwrap();
        let notes_lock = dir.path().join("notes.txt.lock");
        fs::write(&notes_lock, b"").unwrap();

        let result = cleanup_part_in_dir(dir.path());
        assert_eq!(result.deleted_count, 0);
        assert!(notes_lock.exists());
    }

    #[test]
    fn final_from_part_is_inverse_of_staging_shape() {
        assert_eq!(
            final_from_part(Path::new("/d/video.part.mp4")).as_deref(),
            Some(Path::new("/d/video.mp4"))
        );
        assert_eq!(
            final_from_part(Path::new("/d/a (1).part.mp4")).as_deref(),
            Some(Path::new("/d/a (1).mp4"))
        );
        assert_eq!(
            final_from_part(Path::new("/d/my.video.part.mp4")).as_deref(),
            Some(Path::new("/d/my.video.mp4"))
        );
        assert_eq!(final_from_part(Path::new("/d/video.mp4")), None);
        assert_eq!(final_from_part(Path::new("/d/just part")), None);
    }

    #[test]
    fn output_sidecar_matcher_is_narrow() {
        assert!(is_output_sidecar(Path::new("/d/video.mp4.lock")));
        assert!(is_output_sidecar(Path::new("/d/a (1).mp4.lock")));
        // Not ours: wrong extension or bare suffix.
        assert!(!is_output_sidecar(Path::new("/d/notes.txt.lock")));
        assert!(!is_output_sidecar(Path::new("/d/.mp4.lock")));
        // Staging files and finals never match the sidecar rule.
        assert!(!is_output_sidecar(Path::new("/d/video.part.mp4")));
        assert!(!is_output_sidecar(Path::new("/d/video.mp4")));
    }
}
