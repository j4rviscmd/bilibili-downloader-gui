use std::{fs, path::PathBuf};

use crate::{models::settings::Settings, utils::paths};
use anyhow::Result;
use tauri::{AppHandle, Manager};
use tokio::{fs::File, io::AsyncWriteExt};

pub async fn set_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let filepath = paths::get_settings_path(app);
    let settings_str = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // validate settings contents.
    // NOTE: validate_settingsは読み込み時向けのメソッドなので利用しない
    // let _ = validate_settings(app, &filepath).await;

    //違反している場合はFrontendへコードを返却: ERR::<CODE>
    // DL出力ディレクトリの正常性確認
    // 1. ディレクトリパスであること
    let dl_output_dir_path = PathBuf::from(settings.dl_output_path.clone().unwrap());
    if !dl_output_dir_path.is_dir() {
        return Err("ERR:SETTINGS_PATH_NOT_DIRECTORY".to_string());
    }
    // 2. ディレクトリ存在すること
    if !dl_output_dir_path.exists() {
        return Err("ERR:SETTINGS_PATH_NOT_EXIST".to_string());
    }

    fs::write(&filepath, settings_str)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

pub async fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    let filepath = paths::get_settings_path(app);
    // DEBUG: println!("Loading settings from: {:?}", filepath);
    let _ = validate_settings(app, &filepath).await;

    let settings_str = fs::read_to_string(&filepath).unwrap_or_default();
    let mut settings: Settings = serde_json::from_str(&settings_str)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    if settings.dl_output_path.is_none() || settings.dl_output_path.clone().unwrap().is_empty() {
        settings.dl_output_path = Some(
            app.path()
                .download_dir()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
        );
    }

    Ok(settings.clone())
}

async fn validate_settings(app: &AppHandle, filepath: &PathBuf) -> Result<bool> {
    // 存在しない場合は、デフォルトで設定を作成する
    if !filepath.exists() {
        // 親ディレクトリ(lib)が存在しない場合は作成
        if let Some(parent) = filepath.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                // DEBUG: println!("Created settings parent directory: {:?}", parent);
            }
        }
        let default_settings = Settings { dl_output_path: Some(
            app.path()
                .download_dir()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
        ), ..Default::default() };
        let json = serde_json::to_string_pretty(&default_settings)?;

        let mut file = File::create(&filepath).await?;
        file.write_all(json.as_bytes()).await?;

        Ok(true)
    } else {
        Ok(true)
    }
}
