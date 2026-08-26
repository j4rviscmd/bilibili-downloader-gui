//! Log Cleanup Utilities
//!
//! This module provides functionality to clean up old log files
//! based on their last modified time (TTL-based cleanup).

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

const SECONDS_PER_DAY: u64 = 86400;

/// Removes log files older than the specified number of days.
///
/// This function scans the log directory and deletes files with `.log`
/// extension that haven't been modified for more than `days_to_keep` days.
/// The active log file (`app.log`) is never deleted.
///
/// # Arguments
///
/// * `log_dir` - Path to the log directory
/// * `days_to_keep` - Number of days to keep log files (files older than this are deleted)
///
/// # Returns
///
/// Returns `Ok(count)` with the number of deleted files, or an error message.
///
/// # Example
///
/// Why: doctests compile as separate crates, so `crate::` paths do not resolve — use
/// the lib crate name instead (this PR's doctest policy)
/// ```rust,no_run
/// use std::path::Path;
///
/// let log_dir = Path::new("/path/to/logs");
/// bilibili_downloader_gui_lib::utils::log_cleanup::cleanup_old_logs(log_dir, 30).ok();
/// ```
pub fn cleanup_old_logs(log_dir: &Path, days_to_keep: u64) -> Result<usize, String> {
    let mut deleted_count = 0;
    let cutoff_duration = Duration::from_secs(days_to_keep * SECONDS_PER_DAY);
    let now = SystemTime::now();

    if !log_dir.exists() {
        return Ok(0);
    }

    let entries = fs::read_dir(log_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Skip the active log file
        if path.file_name().is_some_and(|name| name == "app.log") {
            continue;
        }

        // Only process .log files
        if path.extension().is_some_and(|ext| ext != "log") {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(elapsed) = now.duration_since(modified) else {
            continue;
        };

        if elapsed > cutoff_duration {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            deleted_count += 1;
            log::info!("[BE] Deleted old log file: {:?}", path);
        }
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_old_logs_missing_dir_returns_zero() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(cleanup_old_logs(&dir.path().join("none"), 30), Ok(0));
    }

    #[test]
    fn cleanup_old_logs_deletes_only_stale_log_files() {
        let dir = tempfile::tempdir().unwrap();
        let stale = dir.path().join("app.20260101.log");
        let fresh = dir.path().join("app.log"); // active log is always skipped
        let stale_txt = dir.path().join("old.txt"); // non-.log ignored
        std::fs::write(&stale, b"x").unwrap();
        std::fs::write(&fresh, b"x").unwrap();
        std::fs::write(&stale_txt, b"x").unwrap();
        // Why days_to_keep=0 instead of back-dating mtimes: a zero cutoff
        // makes every non-active .log stale, exercising the same age
        // comparison with less setup than File::set_modified
        let deleted = cleanup_old_logs(dir.path(), 0).unwrap();
        assert_eq!(deleted, 1);
        assert!(!stale.exists());
        assert!(fresh.exists(), "active app.log is never deleted");
        assert!(stale_txt.exists(), "non-.log files are ignored");
    }

    #[test]
    fn cleanup_old_logs_zero_days_deletes_any_nonactive_log() {
        // days_to_keep=0 -> cutoff 0s: any non-active .log (mtime < now) goes
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.log"), b"x").unwrap();
        std::fs::write(dir.path().join("b.log"), b"x").unwrap();
        std::fs::write(dir.path().join("keepme.log"), b"x").unwrap();
        assert_eq!(cleanup_old_logs(dir.path(), 0), Ok(3));
    }
}
