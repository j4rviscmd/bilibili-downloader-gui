use tauri::{AppHandle, Manager};

use crate::handlers::bilibili;
use crate::handlers::cookie;
use crate::handlers::ffmpeg;
use crate::models::User;

pub mod emits;
pub mod handlers;
pub mod models;
pub mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        // Cookie のメモリキャッシュをグローバルステートとして管理
        .manage(models::CookieCache::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            validate_ffmpeg,
            install_ffmpeg,
            get_cookie,
            fetch_user,
            fetch_video_info,
        ])
        .setup(|app| {
            // 開発環境の場合は、開発者コンソールを有効化
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();

                Ok(())
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn validate_ffmpeg(app: AppHandle) -> bool {
    // ffmpegの有効性チェック処理
    let res = ffmpeg::validate_ffmpeg(&app);

    res
}

#[tauri::command]
async fn install_ffmpeg(app: AppHandle) -> Result<bool, String> {
    // ffmpegバイナリのダウンロード処理
    let res = ffmpeg::install_ffmpeg(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn get_cookie(app: AppHandle) -> Result<bool, String> {
    // firefoxのCookie取得処理
    let res = cookie::get_cookie(&app).await.map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn fetch_user(app: AppHandle) -> Result<Option<User>, String> {
    // firefoxのCookie取得処理
    let user = bilibili::fetch_user_info(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(user)
}

#[tauri::command]
async fn fetch_video_info(app: AppHandle) -> Result<bool, String> {
    let res = bilibili::fetch_video_info(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}
