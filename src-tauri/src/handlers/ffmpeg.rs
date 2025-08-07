use crate::paths::{get_ffmpeg_path, get_ffmpeg_root_path};
use anyhow::Result;
use std::{fs, path::PathBuf, process::Command};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

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

pub async fn handle_download_ffmpeg(app: &AppHandle) -> Result<()> {
    // ffmpegバイナリのダウンロード処理
    // let ffmpeg_path = get_ffmpeg_path(app);
    let ffmpeg_root = get_ffmpeg_root_path(app);

    // ffmpeg_rootが存在しない場合は作成
    if !ffmpeg_root.exists() {
        fs::create_dir_all(&ffmpeg_root).unwrap();
    }

    let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl-shared.tar.xz";
    // ~/bilibili-downloader-gui/src-tauri/target/debug/lib/ffmpeg
    download_url(url, &ffmpeg_root).await?;

    Ok(())
}

async fn download_url(url: &str, dest: &PathBuf) -> Result<()> {
    let mut res = reqwest::get(url).await?;
    let filepath = dest.join(url.split("/").last().unwrap());
    let mut file = tokio::fs::File::create(filepath).await?;

    let total_size = res
        .content_length()
        .ok_or_else(|| anyhow::anyhow!("Content-Length not found"))?;
    let mut downloaded: u64 = 0;

    println!("Starting download from: {}", url);
    println!("Destination: {:?}", dest);
    println!("Total size: {} bytes", total_size);
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&*chunk).await?;
        println!("Downloaded {} bytes", downloaded);
        downloaded += chunk.len() as u64;
    }

    Ok(())
}
