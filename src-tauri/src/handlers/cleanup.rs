//! Temp File Cleanup Handler
//!
//! Cleans up orphaned temporary files left from interrupted downloads.
//!
//! Orphan detection (issue #560): `temp_video_*`/`temp_audio_*` files are
//! held under an exclusive flock for the lifetime of their download, so a
//! file whose flock can be taken has no live owner (the process died before
//! Drop ran) and is deleted immediately regardless of age. `temp_sub_*`
//! files carry no lock and keep the legacy age rule. The same flock rule
//! removes abandoned `*.part.*` staging files from the download output
//! directory.

use fs2::FileExt;
use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::{Duration, SystemTime};

use tauri::AppHandle;

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
/// - `temp_video_*.m4s` / `temp_audio_*.m4s`: deleted as soon as their flock
///   is free (owner died) — age is irrelevant, so a crashed session's files
///   stop occupying disk at the next launch instead of after 24h. A live
///   download (another app instance included) holds the lock and is never
///   touched.
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
                if !is_temp_file(&path) {
                    continue;
                }
                let stale = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .map(|modified| modified < threshold)
                    .unwrap_or(false);
                // Locked media temps skip the age rule entirely; the flock is
                // the liveness signal. Subtitle temps fall back to `stale`.
                let removable = if is_media_temp(&path) {
                    is_unlocked_orphan(&path)
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

/// Removes abandoned `*.part.*` staging files from the download output
/// directory (issue #560). A staging file whose flock is free has no live
/// download behind it (the owning process died before cleanup could run) and
/// is deleted regardless of age.
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
                if is_part_file(&path) && is_unlocked_orphan(&path) {
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

/// `temp_video_*` / `temp_audio_*` files (flock-protected during downloads).
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
        // Simulate a live download: hold the flock across the cleanup call.
        let holder = OpenOptions::new()
            .write(true)
            .read(true)
            .open(&path)
            .unwrap();
        holder.lock_exclusive().unwrap();

        let result = cleanup_temp_files_in_dir(dir.path(), None);
        assert_eq!(
            result.deleted_count, 0,
            "locked temp belongs to a live download"
        );
        assert!(path.exists());
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
}
