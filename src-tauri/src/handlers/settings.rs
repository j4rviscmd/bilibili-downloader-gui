//! Application Settings Management
//!
//! This module handles reading and writing application settings to a JSON file,
//! including validation of download paths and fallback to system defaults.

use std::{fs, path::PathBuf};

use crate::{models::settings::Settings, utils::paths};
use tauri::{AppHandle, Manager};

/// Saves application settings to the settings.json file.
///
/// This function validates that the download output path exists and is a
/// directory before saving. Settings are serialized as pretty-printed JSON.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
/// * `settings` - Settings to be saved
///
/// # Returns
///
/// Returns `Ok(())` on successful save.
///
/// # Errors
///
/// Returns an error if:
/// - Download path is not set (`ERR:SETTINGS_PATH_NOT_SET`)
/// - Download path does not exist (`ERR:SETTINGS_PATH_NOT_EXIST`)
/// - Download path is not a directory (`ERR:SETTINGS_PATH_NOT_DIRECTORY`)
/// - JSON serialization fails
/// - File write fails
pub async fn set_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let filepath = paths::get_settings_path(app);
    let settings_str = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Validate download output directory
    let dl_output_path = settings
        .dl_output_path
        .as_ref()
        .ok_or_else(|| "ERR:SETTINGS_PATH_NOT_SET".to_string())?;
    let dl_output_dir_path = PathBuf::from(dl_output_path);

    if !dl_output_dir_path.exists() {
        return Err("ERR:SETTINGS_PATH_NOT_EXIST".to_string());
    }
    if !dl_output_dir_path.is_dir() {
        return Err("ERR:SETTINGS_PATH_NOT_DIRECTORY".to_string());
    }

    fs::write(&filepath, settings_str)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

/// Loads application settings from the settings.json file.
///
/// Falls back to the system's default download directory if no custom path
/// is configured. If the file doesn't exist or is corrupted, returns default
/// settings without creating the file (file is only created on `set_settings`).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns the current application settings with defaults applied as needed.
/// Never fails - returns defaults on any error.
pub async fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    let filepath = paths::get_settings_path(app);

    // Try to read settings from file
    let settings: Settings = if filepath.exists() {
        match fs::read_to_string(&filepath) {
            Ok(content) if !content.trim().is_empty() => match serde_json::from_str(&content) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to parse settings.json: {}. Using defaults.", e);
                    Settings::default()
                }
            },
            Ok(_) => {
                // Empty file - use defaults
                Settings::default()
            }
            Err(e) => {
                eprintln!("Failed to read settings.json: {}. Using defaults.", e);
                Settings::default()
            }
        }
    } else {
        // File doesn't exist - use defaults without creating file
        Settings::default()
    };

    // Apply default download directory if not set
    let settings = if settings
        .dl_output_path
        .as_ref()
        .is_none_or(|p| p.is_empty())
    {
        let default_path = app
            .path()
            .download_dir()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        Settings {
            dl_output_path: default_path.or(settings.dl_output_path),
            ..settings
        }
    } else {
        settings
    };

    Ok(settings)
}
