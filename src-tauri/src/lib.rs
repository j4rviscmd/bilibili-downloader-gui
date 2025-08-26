use tauri::AppHandle;
#[cfg(debug_assertions)]
use tauri::Manager;

use crate::handlers::bilibili;
use crate::handlers::cookie;
use crate::handlers::ffmpeg;
use crate::handlers::settings;
use crate::models::cookie::CookieCache;
use crate::models::frontend_dto::User;
use crate::models::frontend_dto::Video;
use crate::models::settings::Settings;

pub mod constants;
pub mod emits;
pub mod handlers;
pub mod models;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Cookie のメモリキャッシュをグローバルステートとして管理
        .manage(CookieCache::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            validate_ffmpeg,
            install_ffmpeg,
            get_cookie,
            fetch_user,
            fetch_video_info,
            download_video,
            get_settings,
            set_settings,
            get_os
        ])
        // 開発環境以外で`app`宣言ではBuildに失敗するため、`_app`を使用
        .setup(|_app| {
            // 開発環境の場合は、開発者コンソールを有効化
            #[cfg(debug_assertions)]
            {
                let app = _app;
                let window = app.get_webview_window("main").unwrap();
                let window_height = window.inner_size().unwrap().height;
                // 横幅だけ0まで縮小可能にする
                // 縦幅は現状の値をそのままにする
                let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                    width: 0.0,
                    height: window_height as f64, // 現在の高さを保持
                })));
                window.open_devtools();
            }
            Ok(())
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
async fn fetch_video_info(app: AppHandle, video_id: String) -> Result<Video, String> {
    let res = bilibili::fetch_video_info(&app, &video_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn download_video(
    app: AppHandle,
    video_id: String,
    filename: String,
    quality: i32,
) -> Result<(), String> {
    let res = bilibili::download_video(&app, &video_id, &filename, &quality)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let res = settings::get_settings(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let res = settings::set_settings(&app, &settings)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn get_os() -> String {
    // Returns a normalized OS string used by frontend validation logic
    // std::env::consts::OS already returns one of: "windows", "macos", "linux", etc.
    std::env::consts::OS.to_string()
}
