//! Path Resolution Utilities
//!
//! This module provides functions for resolving platform-specific paths
//! to application resources, including ffmpeg binaries, settings, and
//! the library directory.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Returns the platform-specific path to the ffmpeg binary.
///
/// On Windows: `lib/ffmpeg-master-latest-win64-lgpl-shared/.../bin/ffmpeg.exe`
/// On macOS/Linux: `lib/ffmpeg/ffmpeg`
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
    if cfg!(target_os = "windows") {
        let mut ffmpeg = lib
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("bin")
            .join("ffmpeg");
        ffmpeg.set_extension("exe");
        ffmpeg
    } else {
        lib.join("ffmpeg").join("ffmpeg")
    }
}

/// Returns the platform-specific path to the ffmpeg root directory.
///
/// This is the directory where ffmpeg files are extracted.
///
/// On Windows: `lib/ffmpeg-master-latest-win64-lgpl-shared`
/// On macOS/Linux: `lib/ffmpeg`
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the base library path
///
/// # Returns
///
/// Returns the absolute path to the ffmpeg root directory.
pub fn get_ffmpeg_root_path(app: &AppHandle) -> PathBuf {
    let lib = get_lib_path(app);
    if cfg!(target_os = "windows") {
        lib.join("ffmpeg-master-latest-win64-lgpl-shared")
    } else {
        lib.join("ffmpeg")
    }
}

// /// その他のバイナリやライブラリのパスも同様に追加可能
// pub fn get_lib_path(app: &AppHandle, name: &str) -> PathBuf {
//     app.path_resolver()
//         .resolve_resource(&format!("lib/{}", name))
//         .expect("failed to resolve lib path")
// }

/// Returns the application's library directory path.
///
/// This directory stores application resources including ffmpeg, settings,
/// and temporary files. Falls back to the current directory if the resource
/// directory cannot be determined.
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the resource directory
///
/// # Returns
///
/// Returns the path to the `lib` subdirectory within the application's
/// resource directory, or `./lib` as a fallback.
pub fn get_lib_path(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("lib")
}

/// Returns the path to the application settings file.
///
/// The settings file is stored as `settings.json` in the library directory.
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the library path
///
/// # Returns
///
/// Returns the absolute path to `settings.json`.
pub fn get_settings_path(app: &AppHandle) -> PathBuf {
    let lib = get_lib_path(app);
    lib.join("settings.json")
}
