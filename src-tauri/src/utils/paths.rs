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
//! └── history.json          ← Multi-process safe locked JSON store
//!
//! user-specified libPath/   (default: app_data_dir()/lib/)
//! ├── ffmpeg/
//! │   └── ffmpeg.exe
//! └── (future dependency files will use subdirectory structure)
//! ```

use crate::models::settings::Settings;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

/// Returns the platform-specific ffmpeg subdirectory name.
pub const fn ffmpeg_subdir() -> &'static str {
    if cfg!(target_os = "windows") {
        "ffmpeg-master-latest-win64-gpl"
    } else if cfg!(target_os = "linux") {
        "ffmpeg-master-latest-linux64-gpl"
    } else {
        "ffmpeg"
    }
}

/// Ensures a directory exists, creating it if necessary.
fn ensure_dir_exists(path: &Path) {
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
    resolve_lib_path(&get_settings_path(app), &get_default_lib_path(app))
}

/// Pure variant of [`get_lib_path`] over explicit paths (test seam:
/// runs against a tempfile-backed settings file without an AppHandle).
fn resolve_lib_path(settings_path: &Path, default_path: &Path) -> PathBuf {
    if let Ok(settings_str) = fs::read_to_string(settings_path) {
        if let Ok(settings) = serde_json::from_str::<Settings>(&settings_str) {
            if let Some(custom_path) = settings.lib_path {
                let path = PathBuf::from(custom_path);
                ensure_dir_exists(&path);
                return path;
            }
        }
    }

    ensure_dir_exists(default_path);
    default_path.to_path_buf()
}

/// Returns the platform-specific path to the ffmpeg binary.
///
/// On Windows: `{libPath}/ffmpeg-master-latest-win64-gpl/.../bin/ffmpeg.exe`
/// On Linux: `{libPath}/ffmpeg-master-latest-linux64-gpl/.../bin/ffmpeg`
/// On macOS: `{libPath}/ffmpeg/ffmpeg`
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving the base library path
///
/// # Returns
///
/// Returns the absolute path to the ffmpeg executable.
pub fn get_ffmpeg_path(app: &AppHandle) -> PathBuf {
    ffmpeg_path_in_lib(&get_lib_path(app))
}

/// Pure variant of [`get_ffmpeg_path`] over an explicit lib dir (test seam).
fn ffmpeg_path_in_lib(lib: &Path) -> PathBuf {
    let subdir = ffmpeg_subdir();

    if cfg!(target_os = "windows") {
        lib.join(subdir)
            .join(subdir)
            .join("bin")
            .join("ffmpeg")
            .with_extension("exe")
    } else if cfg!(target_os = "linux") {
        lib.join(subdir).join(subdir).join("bin").join("ffmpeg")
    } else {
        lib.join(subdir).join("ffmpeg")
    }
}

/// Returns the platform-specific path to the ffmpeg root directory.
///
/// This is the directory where ffmpeg files are extracted.
///
/// On Windows: `{libPath}/ffmpeg-master-latest-win64-gpl`
/// On Linux: `{libPath}/ffmpeg-master-latest-linux64-gpl`
/// On macOS: `{libPath}/ffmpeg`
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
/// Settings are stored at `app_data_dir()/settings.json` to ensure
/// they persist across application updates.
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

    /// Writes a settings file with the given `libPath` into `dir` and
    /// returns its path.
    fn write_settings(dir: &Path, lib_path: Option<&str>) -> PathBuf {
        let settings = crate::models::settings::Settings {
            lib_path: lib_path.map(String::from),
            ..Default::default()
        };
        let path = dir.join("settings.json");
        std::fs::write(&path, serde_json::to_string(&settings).unwrap()).unwrap();
        path
    }

    #[test]
    fn ffmpeg_subdir_matches_platform() {
        let subdir = ffmpeg_subdir();
        if cfg!(target_os = "windows") {
            assert_eq!(subdir, "ffmpeg-master-latest-win64-gpl");
        } else if cfg!(target_os = "linux") {
            assert_eq!(subdir, "ffmpeg-master-latest-linux64-gpl");
        } else {
            assert_eq!(subdir, "ffmpeg");
        }
    }

    #[test]
    fn resolve_lib_path_uses_custom_path_when_configured() {
        let tmp = tempfile::tempdir().unwrap();
        let custom = tmp.path().join("custom-lib");
        // The custom dir does not exist yet; resolve must create it
        let settings = write_settings(tmp.path(), custom.to_str());
        let default = tmp.path().join("lib");

        let resolved = resolve_lib_path(&settings, &default);

        assert_eq!(resolved, custom);
        assert!(custom.is_dir(), "custom lib dir must be created on use");
        assert!(
            !default.exists(),
            "default dir must not be created when unused"
        );
    }

    #[test]
    fn resolve_lib_path_falls_back_when_lib_path_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = write_settings(tmp.path(), None);
        let default = tmp.path().join("lib");

        let resolved = resolve_lib_path(&settings, &default);

        assert_eq!(resolved, default);
        assert!(default.is_dir(), "default lib dir must be created on use");
    }

    #[test]
    fn resolve_lib_path_falls_back_when_settings_missing_or_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("nonexistent-settings.json");
        let default = tmp.path().join("lib");
        assert_eq!(
            resolve_lib_path(&missing, &default),
            default,
            "missing settings file must fall back to default"
        );

        let invalid = tmp.path().join("invalid.json");
        std::fs::write(&invalid, "not json{").unwrap();
        assert_eq!(
            resolve_lib_path(&invalid, &default),
            default,
            "unparseable settings file must fall back to default"
        );
    }

    #[test]
    fn ffmpeg_paths_under_lib_match_platform_layout() {
        let lib = Path::new("/fake/lib");
        let bin = ffmpeg_path_in_lib(lib);

        // Why: the doubled join(ffmpeg_subdir()) is not a bug — BtbN win64/linux
        // archives contain a top-level folder named after the archive and are
        // extracted into {lib}/{subdir} (get_ffmpeg_root_path), so the binary
        // lands at {lib}/{subdir}/{subdir}/bin/ffmpeg; only the macOS archive is
        // flat (commit 17e0db3 "Fix FFmpeg path double-nesting").
        if cfg!(target_os = "windows") {
            assert_eq!(
                bin,
                lib.join(ffmpeg_subdir())
                    .join(ffmpeg_subdir())
                    .join("bin")
                    .join("ffmpeg")
                    .with_extension("exe")
            );
        } else if cfg!(target_os = "linux") {
            assert_eq!(
                bin,
                lib.join(ffmpeg_subdir())
                    .join(ffmpeg_subdir())
                    .join("bin")
                    .join("ffmpeg")
            );
        } else {
            // macOS: flat layout {lib}/ffmpeg/ffmpeg
            assert_eq!(bin, lib.join(ffmpeg_subdir()).join("ffmpeg"));
        }
    }
}
