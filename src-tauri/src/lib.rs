use tauri::AppHandle;

use crate::handlers::{
    cookie::handle_get_cookie,
    ffmpeg::{handle_install_ffmpeg, handle_validate_ffmpeg},
};

pub mod emits;
pub mod handlers;
pub mod models;
pub mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Cookie のメモリキャッシュをグローバルステートとして管理
        .manage(models::CookieCache::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            validate_ffmpeg,
            install_ffmpeg,
            get_cookie,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn validate_ffmpeg(app: AppHandle) -> bool {
    // ffmpegの有効性チェック処理
    let res = handle_validate_ffmpeg(&app);

    res
}

#[tauri::command]
async fn install_ffmpeg(app: AppHandle) -> Result<bool, String> {
    // ffmpegバイナリのダウンロード処理
    let res = handle_install_ffmpeg(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn get_cookie(app: AppHandle) -> Result<bool, String> {
    // firefoxのCookie取得処理
    let res = handle_get_cookie(&app).await.map_err(|e| e.to_string())?;

    Ok(res)
}
