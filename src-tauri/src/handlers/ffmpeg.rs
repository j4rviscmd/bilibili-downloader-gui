use crate::emits::Emits;
use crate::utils::downloads::download_url;
use crate::utils::paths::{get_ffmpeg_path, get_ffmpeg_root_path};
use anyhow::Result;
use std::fs::File;
use std::{fs, path::PathBuf, process::Command};
use tauri::AppHandle;
use tokio::process::Command as AsyncCommand;

/**
 * FFmpegの有効性チェック処理
 */
pub fn validate_ffmpeg(app: &AppHandle) -> bool {
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

    // ffmpeg --helpを実行して終了コードを確認
    let is_valid_cmd = validate_command(&ffmpeg_path);
    if !is_valid_cmd {
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

pub async fn install_ffmpeg(app: &AppHandle) -> Result<bool> {
    // ffmpegバイナリのダウンロード処理
    // let ffmpeg_path = get_ffmpeg_path(app);
    let ffmpeg_root = get_ffmpeg_root_path(app);

    // ffmpeg_rootが存在しない場合は作成
    if !ffmpeg_root.exists() {
        fs::create_dir_all(&ffmpeg_root).unwrap();
    }

    // let url = "https://evermeet.cx/ffmpeg/getrelease/zip";
    let url = if cfg!(target_os = "windows") {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip"
    } else if cfg!(target_os = "macos") {
        "https://evermeet.cx/ffmpeg/getrelease/zip"
    } else {
        ""
    };
    // ダウンロードするファイル名
    let filename = if cfg!(target_os = "windows") {
        "ffmpeg-master-latest-win64-lgpl-shared.zip"
    } else if cfg!(target_os = "macos") {
        "ffmpeg.zip"
    } else {
        return Ok(false); // 対応していないOSの場合は終了
    };
    // ~/bilibili-downloader-gui/src-tauri/target/debug/lib/ffmpeg
    let archive_path = ffmpeg_root.join(filename);
    if let Ok(()) = download_url(app, url.to_string(), archive_path.clone(), None, true).await {
        println!("FFmpegのダウンロードが完了しました: {:?}", ffmpeg_root);
        if let Ok(is_unpacked) = unpack_archive(&archive_path, &ffmpeg_root).await {
            if is_unpacked {
                println!("FFmpegのアーカイブを展開しました: {:?}", ffmpeg_root);
                // アーカイブの展開が成功したら、アーカイブファイルを削除
                fs::remove_file(archive_path).ok();

                // NOTE: ffmpegに実行権限付与
                if cfg!(target_os = "macos") {
                    let err_msg = format!(
                        "FFmpegの実行権限付与に失敗: {:?}",
                        ffmpeg_root.join("ffmpeg").to_str().unwrap()
                    );
                    let res = Command::new("chmod")
                        .arg("+x")
                        .arg(ffmpeg_root.join("ffmpeg").to_str().unwrap())
                        .output()
                        .expect(&err_msg);

                    if !res.status.success() {
                        return Ok(false);
                    };
                }
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

fn validate_command(path: &PathBuf) -> bool {
    // pathの存在チェック
    if !path.exists() {
        return false;
    }

    // {path} --helpを実行して終了コードを確認
    let cmd = Command::new(path).arg("--help").output();
    if let Err(e) = cmd {
        println!("`{} --help`の実行に失敗: {}", path.to_string_lossy(), e);
        return false;
    }

    true
}

pub async fn merge_av(
    app: &AppHandle,
    video_path: &PathBuf,
    audio_path: &PathBuf,
    output_path: &PathBuf,
) -> Result<(), String> {
    let filename = output_path.file_stem().unwrap().to_str().unwrap();
    let emits = Emits::new(app.clone(), filename.to_string(), None);
    let ffmpeg_path = get_ffmpeg_path(app);
    // ffmpeg コマンド実行（非同期）
    let status = AsyncCommand::new(ffmpeg_path)
        .args([
            "-i",
            video_path.to_str().unwrap(),
            "-i",
            audio_path.to_str().unwrap(),
            "-c:v",
            "copy", // 再エンコードせずコピー
            "-c:a",
            "aac",
            "-y", // 上書き許可
            output_path.to_str().unwrap(),
        ])
        .status()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !status.success() {
        return Err("ffmpeg failed to merge video and audio".into());
    }
    emits.complete().await;

    Ok(())
}
