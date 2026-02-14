//! Temp File Cleanup Handler
//!
//! Cleans up orphaned temporary files left from interrupted downloads.

use std::fs;
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

/// Cleans up orphaned temporary files older than 24 hours.
///
/// Scans the lib directory for temp files matching:
/// - `temp_video_*.m4s`
/// - `temp_audio_*.m4s`
///
/// Files older than 24 hours are deleted.
pub fn cleanup_temp_files(app: &AppHandle, max_age_hours: Option<u64>) -> CleanupResult {
    let lib_path = get_lib_path(app);
    let max_age = max_age_hours.unwrap_or(DEFAULT_MAX_AGE_HOURS);
    let threshold = SystemTime::now() - Duration::from_secs(max_age * 60 * 60);

    let mut result = CleanupResult::default();

    if !lib_path.exists() {
        return result;
    }

    match fs::read_dir(&lib_path) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_temp_file(&path) {
                    if let Ok(metadata) = entry.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if modified < threshold {
                                match fs::remove_file(&path) {
                                    Ok(()) => {
                                        println!("[Cleanup] Deleted temp file: {:?}", path);
                                        result.deleted_count += 1;
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[Cleanup] Failed to delete temp file {:?}: {}",
                                            path, e
                                        );
                                        result.failed_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("[Cleanup] Failed to read lib directory: {}", e);
        }
    }

    result
}

/// Checks if a file is a temp download file.
///
/// # Temp File Pattern
///
/// Matches files with the following naming conventions:
/// - `temp_video_*.m4s` - Temporary video segments
/// - `temp_audio_*.m4s` - Temporary audio segments
///
/// # Arguments
///
/// * `path` - Path to the file to check
///
/// # Returns
///
/// `true` if the file matches the temp file pattern, `false` otherwise
///
/// # Examples
///
/// ```
/// # use std::path::Path;
/// # use crate::handlers::cleanup::is_temp_file;
/// assert!(is_temp_file(Path::new("temp_video_123.m4s")));
/// assert!(is_temp_file(Path::new("temp_audio_456.m4s")));
/// assert!(!is_temp_file(Path::new("final_video.mp4")));
/// ```
fn is_temp_file(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name,
        None => return false,
    };

    (file_name.starts_with("temp_video_") || file_name.starts_with("temp_audio_"))
        && file_name.ends_with(".m4s")
}
