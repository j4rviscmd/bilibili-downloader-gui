use crate::paths::{get_ffmpeg_path, get_ffmpeg_root_path};
use std::{fs, process::Command};
use tauri::AppHandle;

/**
 * FFmpegの有効性チェック処理
 */
pub fn handle_validate_ffmpeg(app: &AppHandle) -> bool {
    let ffmpeg_path = get_ffmpeg_path(app);
    // ffmpegの存在チェック処理
    if ffmpeg_path.exists() {
        return false;
    }

    // ffmpeg --versionを実行して終了コードを確認
    let cmd = Command::new(ffmpeg_path).arg("--version").output();
    if let Err(e) = cmd {
        println!("FFmpegの実行に失敗: {}", e);
        // エラーが発生した場合は無効とみなし、lib直下のffmpegを削除 & falseを返す
        let ffmpeg_root = get_ffmpeg_root_path(app);
        if ffmpeg_root.is_dir() {
            fs::remove_dir_all(&ffmpeg_root).ok();
        } else if ffmpeg_root.is_file() {
            fs::remove_file(&ffmpeg_root).ok();
        }
        return false;
    }

    true
}
