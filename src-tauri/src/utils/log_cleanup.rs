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
/// ```rust,no_run
/// use std::path::Path;
///
/// let log_dir = Path::new("/path/to/logs");
/// crate::utils::log_cleanup::cleanup_old_logs(log_dir, 30).ok();
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
        if path.file_name().map_or(false, |name| name == "app.log") {
            continue;
        }

        // Only process .log files
        if !path.extension().map_or(false, |ext| ext == "log") {
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
