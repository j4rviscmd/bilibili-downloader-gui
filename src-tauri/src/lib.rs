use tauri::AppHandle;

use crate::handlers::ffmpeg::handle_validate_ffmpeg;

pub mod handlers;
pub mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            validate_ffmpeg,
            //
            download_ffmpeg,
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
async fn download_ffmpeg() -> Result<(), String> {
    // ffmpegバイナリのダウンロード処理
    Ok(())
}
