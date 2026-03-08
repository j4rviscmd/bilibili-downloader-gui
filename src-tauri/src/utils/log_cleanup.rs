//! Log Cleanup Utility
//!
//! Provides functionality to clean up old log files based on TTL (time-to-live).
//! Removes log files older than the specified number of days while preserving
//! the active log file (app.log).

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

const SECONDS_PER_DAY: u64 = 86_400;

/// Cleans up old log files from the specified directory.
///
/// This function scans the log directory for files with `.log` extension
/// and removes those that haven't been modified within the specified number of days.
/// The active log file (`app.log`) is always preserved.
///
/// # Arguments
///
/// * `log_dir` - Path to the directory containing log files
/// * `days_to_keep` - Number of days to preserve log files (files older than this will be deleted)
///
/// # Returns
///
/// Returns `Ok(count)` with the number of files deleted, or an error string if the operation fails.
///
/// # Errors
///
/// Returns an error if:
/// - The directory cannot be read
/// - File metadata cannot be accessed
/// - File deletion fails
///
/// # Example
///
/// ```rust,no_run
/// use std::path::Path;
///
/// let log_dir = Path::new("/var/log/myapp");
/// match cleanup_old_logs(&log_dir, 30) {
///     Ok(count) => println!("Deleted {} old log files", count),
///     Err(e) => eprintln!("Cleanup failed: {}", e),
/// }
/// ```
pub fn cleanup_old_logs(log_dir: &Path, days_to_keep: u64) -> Result<usize, String> {
    let mut deleted_count = 0;
    let cutoff_duration = Duration::from_secs(days_to_keep * SECONDS_PER_DAY);
    let now = SystemTime::now();

    if !log_dir.exists() {
        return Ok(0);
    }

    for entry in fs::read_dir(log_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Skip the active log file (app.log)
        if path.file_name().map_or(false, |name| name == "app.log") {
            continue;
        }

        // Only process files with .log extension
        if path.extension().map_or(false, |ext| ext == "log") {
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = now.duration_since(modified) {
                    if elapsed > cutoff_duration {
                        fs::remove_file(&path).map_err(|e| e.to_string())?;
                        deleted_count += 1;
                        log::info!("[BE] Deleted old log file: {:?}", path);
                    }
                }
            }
        }
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_cleanup_old_logs_deletes_expired_files() {
        let temp_dir = TempDir::new().unwrap();
        let log_dir = temp_dir.path();

        // Create old log file
        let old_log = log_dir.join("old.log");
        let mut file = File::create(&old_log).unwrap();
        file.write_all(b"old log content").unwrap();
        drop(file);

        // Set modification time to 40 days ago
        let forty_days_ago = SystemTime::now()
            .checked_sub(Duration::from_secs(40 * SECONDS_PER_DAY))
            .unwrap();
        filetime::set_file_mtime(&old_log, forty_days_ago.into()).unwrap();

        // Create recent log file
        let recent_log = log_dir.join("recent.log");
        let mut file = File::create(&recent_log).unwrap();
        file.write_all(b"recent log content").unwrap();
        drop(file);

        // Run cleanup keeping 30 days
        let deleted = cleanup_old_logs(log_dir, 30).unwrap();

        assert_eq!(deleted, 1);
        assert!(!old_log.exists());
        assert!(recent_log.exists());
    }

    #[test]
    fn test_cleanup_preserves_active_log() {
        let temp_dir = TempDir::new().unwrap();
        let log_dir = temp_dir.path();

        // Create app.log with old modification time
        let app_log = log_dir.join("app.log");
        let mut file = File::create(&app_log).unwrap();
        file.write_all(b"active log content").unwrap();
        drop(file);

        let forty_days_ago = SystemTime::now()
            .checked_sub(Duration::from_secs(40 * SECONDS_PER_DAY))
            .unwrap();
        filetime::set_file_mtime(&app_log, forty_days_ago.into()).unwrap();

        // Run cleanup
        let deleted = cleanup_old_logs(log_dir, 30).unwrap();

        assert_eq!(deleted, 0);
        assert!(app_log.exists());
    }

    #[test]
    fn test_cleanup_returns_zero_for_nonexistent_directory() {
        let nonexistent = Path::new("/nonexistent/path/that/does/not/exist");
        let result = cleanup_old_logs(nonexistent, 30);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }
}
