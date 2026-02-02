//! Path Resolution Utilities
//!
//! This module provides functions for resolving platform-specific paths
//! to application resources, including ffmpeg binaries, settings, and
//! the library directory.
//!
//! ## Directory Structure
//!
//! ```text
//! app_data_dir()/
//! ├── settings.json         ← Fixed (user cannot change)
//! └── history.json          ← Managed by tauri-plugin-store
//!
//! user-specified libPath/   (default: app_data_dir()/lib/)
//! ├── ffmpeg/
//! │   └── ffmpeg.exe
//! └── (future dependency files will use subdirectory structure)
//! ```

use crate::models::settings::Settings;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

/// Returns the platform-specific ffmpeg subdirectory name.
const fn ffmpeg_subdir() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg-master-latest-win64-lgpl-shared"
    } else {
        "ffmpeg"
    }
}

/// Ensures a directory exists, creating it if necessary.
fn ensure_dir_exists(path: &PathBuf) {
    if !path.exists() {
        let _ = fs::create_dir_all(path);
    }
}

/// Returns the default library directory path.
///
/// This returns `app_data_dir()/lib/` which is used when:
/// - No custom `lib_path` is configured in settings
/// - Settings file cannot be read
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the app data directory
///
/// # Returns
///
/// Returns the path to the default lib directory.
pub fn get_default_lib_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("lib")
}

/// Returns the library directory path from user settings.
///
/// Reads the `lib_path` from `settings.json` and returns it.
/// If not configured or settings cannot be read, falls back to
/// the default path (`app_data_dir()/lib/`).
///
/// Creates the directory if it doesn't exist.
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving paths
///
/// # Returns
///
/// Returns the configured library path or the default path.
pub fn get_lib_path(app: &AppHandle) -> PathBuf {
    let settings_path = get_settings_path(app);

    if let Ok(settings_str) = fs::read_to_string(&settings_path) {
        if let Ok(settings) = serde_json::from_str::<Settings>(&settings_str) {
            if let Some(custom_path) = settings.lib_path {
                let path = PathBuf::from(custom_path);
                ensure_dir_exists(&path);
                return path;
            }
        }
    }

    let default_path = get_default_lib_path(app);
    ensure_dir_exists(&default_path);
    default_path
}

/// Returns the platform-specific path to the ffmpeg binary.
///
/// On Windows: `{libPath}/ffmpeg-master-latest-win64-lgpl-shared/.../bin/ffmpeg.exe`
/// On macOS/Linux: `{libPath}/ffmpeg/ffmpeg`
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the base library path
///
/// # Returns
///
/// Returns the absolute path to the ffmpeg executable.
pub fn get_ffmpeg_path(app: &AppHandle) -> PathBuf {
    let lib = get_lib_path(app);
    let subdir = ffmpeg_subdir();

    if cfg!(target_os = "windows") {
        lib.join(subdir)
            .join(subdir)
            .join("bin")
            .join("ffmpeg")
            .with_extension("exe")
    } else {
        lib.join(subdir).join("ffmpeg")
    }
}

/// Returns the platform-specific path to the ffmpeg root directory.
///
/// This is the directory where ffmpeg files are extracted.
///
/// On Windows: `{libPath}/ffmpeg-master-latest-win64-lgpl-shared`
/// On macOS/Linux: `{libPath}/ffmpeg`
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the base library path
///
/// # Returns
///
/// Returns the absolute path to the ffmpeg root directory.
pub fn get_ffmpeg_root_path(app: &AppHandle) -> PathBuf {
    get_lib_path(app).join(ffmpeg_subdir())
}

/// Returns the path to the application settings file.
///
/// **CHANGED:** Now stores settings at `app_data_dir()/settings.json`
/// (previously was at `resource_dir()/lib/settings.json`).
///
/// This ensures settings persist across application updates.
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the app data directory
///
/// # Returns
///
/// Returns the absolute path to `settings.json`.
pub fn get_settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_settings_path_returns_app_data_dir() {
        // This test verifies that settings are stored in app_data_dir
        // Actual implementation requires Tauri test context
    }
}
