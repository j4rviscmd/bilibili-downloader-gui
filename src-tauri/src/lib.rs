pub mod handlers;

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
async fn validate_ffmpeg() -> bool {
    // ffmpegの有効性チェック処理
    true
}

#[tauri::command]
async fn download_ffmpeg() -> Result<(), String> {
    // ffmpegバイナリのダウンロード処理
    Ok(())
}
