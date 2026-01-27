//! Application Settings Management
//!
//! This module handles reading and writing application settings to a JSON file,
//! including validation of download paths and fallback to system defaults.

use std::{fs, path::PathBuf};

use crate::{models::settings::Settings, utils::paths};
use anyhow::Result;
use tauri::{AppHandle, Manager};
use tokio::{fs::File, io::AsyncWriteExt};

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

    // validate settings contents.
    // NOTE: validate_settingsは読み込み時向けのメソッドなので利用しない
    // let _ = validate_settings(app, &filepath).await;

    // Validate download output directory
    let dl_output_path = settings
        .dl_output_path
        .as_ref()
        .ok_or_else(|| "ERR:SETTINGS_PATH_NOT_SET".to_string())?;
    let dl_output_dir_path = PathBuf::from(dl_output_path);
    // Check existence first, then check if it's a directory
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
/// If the settings file doesn't exist, it creates one with default values.
/// Falls back to the system's default download directory if no custom path
/// is configured.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns the current application settings with defaults applied as needed.
///
/// # Errors
///
/// Returns an error if:
/// - JSON parsing fails
/// - File read fails (after initial creation attempt)
pub async fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    let filepath = paths::get_settings_path(app);
    // DEBUG: println!("Loading settings from: {:?}", filepath);
    let _ = validate_settings(app, &filepath).await;

    let settings_str = fs::read_to_string(&filepath).unwrap_or_default();
    let mut settings: Settings = serde_json::from_str(&settings_str)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    let needs_default = settings
        .dl_output_path
        .as_ref()
        .is_none_or(|p| p.is_empty());
    if needs_default {
        if let Ok(download_dir) = app.path().download_dir() {
            if let Some(path_str) = download_dir.to_str() {
                settings.dl_output_path = Some(path_str.to_string());
            }
        }
    }

    Ok(settings.clone())
}

/// Validates that the settings file exists, creating it with defaults if missing.
///
/// This internal function ensures the settings file and its parent directory
/// exist, creating them with sensible defaults if they don't.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing system paths
/// * `filepath` - Path to the settings.json file
///
/// # Returns
///
/// Returns `Ok(true)` whether the file existed or was newly created.
///
/// # Errors
///
/// Returns an error if:
/// - Directory creation fails
/// - File creation fails
/// - JSON serialization fails
async fn validate_settings(app: &AppHandle, filepath: &PathBuf) -> Result<bool> {
    if filepath.exists() {
        return Ok(true);
    }

    // Create parent directory if it doesn't exist
    if let Some(parent) = filepath.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }

    // Build default settings with download directory fallback
    let default_dl_path = app
        .path()
        .download_dir()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()));
    let default_settings = Settings {
        dl_output_path: default_dl_path,
        download_speed_threshold_mbps: 1.0, // Default 1 MB/s
        ..Default::default()
    };
    let json = serde_json::to_string_pretty(&default_settings)?;

    let mut file = File::create(filepath).await?;
    file.write_all(json.as_bytes()).await?;

    Ok(true)
}
