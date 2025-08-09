use crate::paths::{get_ffmpeg_path, get_ffmpeg_root_path};
use anyhow::Result;
use std::fs::File;
use std::{fs, path::PathBuf, process::Command};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

/**
 * FFmpegの有効性チェック処理
 */
pub fn handle_validate_ffmpeg(app: &AppHandle) -> bool {
    let ffmpeg_root = get_ffmpeg_root_path(app);
    let ffmpeg_path = get_ffmpeg_path(app);
    // ffmpeg rootの存在チェック処理
    if !ffmpeg_root.exists() {
        return false;
    }
    // ffmpegの存在チェック処理
    if !ffmpeg_path.exists() {
        // ffmpegのパスが存在しない場合は無効とみなし、lib直下のffmpegを削除 & falseを返す
        if ffmpeg_root.is_dir() {
            fs::remove_dir_all(&ffmpeg_root).ok();
        }
        return false;
    }

    // ffmpeg --versionを実行して終了コードを確認
    let cmd = Command::new(ffmpeg_path).arg("--version").output();
    if let Err(e) = cmd {
        println!("FFmpegの実行に失敗: {}", e);
        // エラーが発生した場合は無効とみなし、lib直下のffmpegを削除 & falseを返す
        if ffmpeg_root.is_dir() {
            fs::remove_dir_all(&ffmpeg_root).ok();
        } else if ffmpeg_root.is_file() {
            fs::remove_file(&ffmpeg_root).ok();
        }
        return false;
    }

    true
}

pub async fn handle_install_ffmpeg(app: &AppHandle) -> Result<bool> {
    // ffmpegバイナリのダウンロード処理
    // let ffmpeg_path = get_ffmpeg_path(app);
    let ffmpeg_root = get_ffmpeg_root_path(app);

    // ffmpeg_rootが存在しない場合は作成
    if !ffmpeg_root.exists() {
        fs::create_dir_all(&ffmpeg_root).unwrap();
    }

    // TODO: os判定
    let url = "https://evermeet.cx/ffmpeg/getrelease/zip";
    // ダウンロードするファイル名
    let filename = "ffmpeg.zip";
    // ~/bilibili-downloader-gui/src-tauri/target/debug/lib/ffmpeg
    if let Ok(archive_path) = download_url(url, &ffmpeg_root, filename).await {
        println!("FFmpegのダウンロードが完了しました: {:?}", ffmpeg_root);
        if let Ok(is_unpacked) = unpack_archive(&archive_path, &ffmpeg_root).await {
            if is_unpacked {
                println!("FFmpegのアーカイブを展開しました: {:?}", ffmpeg_root);
                // アーカイブの展開が成功したら、アーカイブファイルを削除
                fs::remove_file(archive_path).ok();
            } else {
                println!("FFmpegのアーカイブの展開に失敗しました: {:?}", archive_path);
                return Ok(false);
            }
        } else {
            println!("FFmpegのアーカイブの展開に失敗しました: {:?}", archive_path);
            return Ok(false);
        }
    } else {
        println!("FFmpegのダウンロードに失敗しました: {:?}", ffmpeg_root);
        return Ok(false);
    }

    Ok(true)
}

async fn unpack_archive(archive_path: &PathBuf, dest: &PathBuf) -> Result<bool> {
    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    println!("Unpacking archive: {:?} to {:?}", archive_path, dest);
    println!("Archive extension: {}", ext);

    let fname = archive_path
        .file_name()
        .and_then(|os| os.to_str())
        .unwrap_or_default();

    if fname.ends_with(".tar.xz") {
        println!("Unpacking tar.xz archive: {:?}", archive_path);
        let tar = xz2::read::XzDecoder::new(File::open(archive_path)?);
        let mut archive = tar::Archive::new(tar);
        archive.unpack(dest)?;
    } else if ext == "zip" {
        println!("Unpacking zip archive: {:?}", archive_path);
        let file = File::open(archive_path)?;
        let mut archive = zip::ZipArchive::new(file)?;

        // 出力先ディレクトリが存在しない場合は作成
        if !dest.exists() {
            std::fs::create_dir_all(dest)?;
        }

        // アーカイブ内の各ファイルを展開
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let outpath = dest.join(file.name());

            // ディレクトリの場合はスキップ
            if file.name().ends_with('/') {
                continue;
            }

            // ファイルを展開
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p)?;
                }
            }

            let mut outfile = File::create(outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    } else {
        // anyhow::bail!("Unsupported archive format: {}", fname);
        return Ok(false);
    }

    Ok(true)
}

async fn download_url(url: &str, dest: &PathBuf, filename: &str) -> Result<PathBuf> {
    let mut res = reqwest::get(url).await?;
    let filepath = dest.join(filename);
    let mut file = tokio::fs::File::create(&filepath).await?;

    let total_size = res
        .content_length()
        .ok_or_else(|| anyhow::anyhow!("Content-Length not found"))?;
    let mut downloaded: u64 = 0;

    println!("Starting download from: {}", url);
    println!("Destination: {:?}", dest);
    println!("Total size: {} bytes", total_size);
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&*chunk).await?;
        // println!("Downloaded {} bytes", downloaded);
        println!(
            "Downloaded {} bytes / {} bytes ({}%)",
            downloaded,
            total_size,
            downloaded * 100 / total_size
        );
        downloaded += chunk.len() as u64;
    }

    Ok(filepath)
}
