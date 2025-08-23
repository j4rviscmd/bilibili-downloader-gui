use std::{fs, path::PathBuf};

use crate::{models::settings::Settings, utils::paths};
use anyhow::Result;
use tauri::AppHandle;
use tokio::{fs::File, io::AsyncWriteExt};

pub async fn set_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let filepath = paths::get_settings_path(app);
    let settings_str = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&filepath, settings_str)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

pub async fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    let filepath = paths::get_settings_path(app);
    println!("Loading settings from: {:?}", filepath);
    let _ = validate_settings(&filepath).await;

    let settings_str = fs::read_to_string(&filepath).unwrap_or_default();
    let settings: Settings = serde_json::from_str(&settings_str)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    Ok(settings)
}

async fn validate_settings(filepath: &PathBuf) -> Result<bool> {
    // 存在しない場合は、デフォルトで設定を作成する
    if !filepath.exists() {
        let default_settings = Settings::default();
        let json = serde_json::to_string_pretty(&default_settings)?;
        let mut file = File::create(&filepath).await?;
        file.write_all(json.as_bytes()).await?;
        println!("Default settings: \n{}", json);

        Ok(true)
    } else {
        Ok(false)
    }
}
