//! FFmpeg Binary Management
//!
//! This module handles ffmpeg installation, validation, and video/audio merging.
//! It downloads platform-specific ffmpeg binaries and provides functionality
//! to merge separate video and audio streams into a single MP4 file.

use crate::emits::Emits;
use crate::utils::downloads::download_url;
use crate::utils::paths::{get_ffmpeg_path, get_ffmpeg_root_path};
use anyhow::Result;
use std::fs::File;
use std::{fs, path::PathBuf, process::Command};
use tauri::AppHandle;
use tokio::process::Command as AsyncCommand;

/// Validates whether ffmpeg is properly installed and functional.
///
/// This function checks if:
/// 1. The ffmpeg root directory exists
/// 2. The ffmpeg binary exists
/// 3. The ffmpeg binary can be executed (via `--help` command)
///
/// If validation fails, it removes the ffmpeg directory to allow clean reinstallation.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns `true` if ffmpeg is valid and executable, `false` otherwise.
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

/// Downloads and installs the ffmpeg binary for the current platform.
///
/// This function:
/// 1. Creates the ffmpeg directory if needed
/// 2. Downloads the appropriate binary for Windows or macOS
/// 3. Extracts the archive
/// 4. Sets execute permissions (macOS only)
/// 5. Cleans up the downloaded archive
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns `Ok(true)` on successful installation, `Ok(false)` if the platform
/// is not supported or download/extraction fails.
///
/// # Errors
///
/// Returns an error if:
/// - Directory creation fails
/// - Archive extraction fails
/// - Permission setting fails (macOS)
pub async fn install_ffmpeg(app: &AppHandle) -> Result<bool> {
    // ffmpegバイナリのダウンロード処理
    // let ffmpeg_path = get_ffmpeg_path(app);
    let ffmpeg_root = get_ffmpeg_root_path(app);

    // ffmpeg_rootが存在しない場合は作成
    if !ffmpeg_root.exists() {
        fs::create_dir_all(&ffmpeg_root)
            .map_err(|e| anyhow::anyhow!("Failed to create ffmpeg directory: {}", e))?;
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
    if download_url(app, url.to_string(), archive_path.clone(), None, true, None)
        .await
        .is_err()
    {
        return Ok(false);
    }

    let is_unpacked = unpack_archive(&archive_path, &ffmpeg_root)
        .await
        .unwrap_or(false);
    if !is_unpacked {
        return Ok(false);
    }

    // Remove archive file after successful extraction
    fs::remove_file(&archive_path).ok();

    // Grant execute permission on macOS
    #[cfg(target_os = "macos")]
    {
        let ffmpeg_bin = ffmpeg_root.join("ffmpeg");
        let ffmpeg_path_str = ffmpeg_bin
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("Invalid ffmpeg path"))?;
        let res = Command::new("chmod")
            .arg("+x")
            .arg(ffmpeg_path_str)
            .output()
            .map_err(|e| anyhow::anyhow!("Failed to set execute permission: {}", e))?;
        if !res.status.success() {
            return Ok(false);
        }
    }

    Ok(true)
}

/// Extracts an archive file to a destination directory.
///
/// Supports .tar.xz and .zip formats. For ZIP files, it handles nested
/// directory structures and skips directory entries.
///
/// # Arguments
///
/// * `archive_path` - Path to the archive file
/// * `dest` - Destination directory for extracted files
///
/// # Returns
///
/// Returns `Ok(true)` on successful extraction, `Ok(false)` if the format
/// is unsupported.
///
/// # Errors
///
/// Returns an error if extraction or file I/O fails.
async fn unpack_archive(archive_path: &PathBuf, dest: &PathBuf) -> Result<bool> {
    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    let fname = archive_path
        .file_name()
        .and_then(|os| os.to_str())
        .unwrap_or_default();

    if fname.ends_with(".tar.xz") {
        let tar = xz2::read::XzDecoder::new(File::open(archive_path)?);
        let mut archive = tar::Archive::new(tar);
        archive.unpack(dest)?;
    } else if ext == "zip" {
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

/// Validates that a binary can be executed by running it with --help.
///
/// On Windows, this function prevents console window creation during validation.
///
/// # Arguments
///
/// * `path` - Path to the binary to validate
///
/// # Returns
///
/// Returns `true` if the binary exists and can be executed successfully.
fn validate_command(path: &PathBuf) -> bool {
    if !path.exists() {
        return false;
    }

    let mut cmd_builder = Command::new(path);
    cmd_builder.arg("--help");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd_builder.creation_flags(CREATE_NO_WINDOW);
    }

    cmd_builder.output().is_ok()
}

/// Merges separate video and audio files into a single MP4 file.
///
/// This function uses ffmpeg to combine video and audio streams:
/// - Video stream is copied without re-encoding (fast)
/// - Audio stream is re-encoded to AAC
///
/// Progress events are emitted to the frontend during the merge process.
///
/// # Arguments
///
/// * `app` - Tauri application handle for event emission
/// * `video_path` - Path to the video file (.m4s)
/// * `audio_path` - Path to the audio file (.m4s)
/// * `output_path` - Path for the merged output file (.mp4)
/// * `download_id` - Optional download ID for progress tracking
///
/// # Returns
///
/// Returns `Ok(())` on successful merge.
///
/// # Errors
///
/// Returns an error if:
/// - File paths contain invalid UTF-8
/// - ffmpeg execution fails
/// - ffmpeg returns a non-zero exit code
pub async fn merge_av(
    app: &AppHandle,
    video_path: &std::path::Path,
    audio_path: &std::path::Path,
    output_path: &std::path::Path,
    download_id: Option<String>,
) -> Result<(), String> {
    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let id_for_emit = download_id.unwrap_or_else(|| filename.to_string());
    let emits = Emits::new(app.clone(), id_for_emit, None);
    let _ = emits.set_stage("merge").await;

    let ffmpeg_path = get_ffmpeg_path(app);
    let video_str = video_path
        .to_str()
        .ok_or_else(|| "Invalid video path".to_string())?;
    let audio_str = audio_path
        .to_str()
        .ok_or_else(|| "Invalid audio path".to_string())?;
    let output_str = output_path
        .to_str()
        .ok_or_else(|| "Invalid output path".to_string())?;

    let mut cmd = AsyncCommand::new(ffmpeg_path);
    cmd.args([
        "-i", video_str, "-i", audio_str, "-c:v", "copy", "-c:a", "aac", "-y", output_str,
    ]);

    // Windowsでコンソールウィンドウが開かないようにする
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let status = cmd
        .status()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !status.success() {
        return Err("ffmpeg failed to merge video and audio".into());
    }
    // 完了ステージを送信後 complete 呼び出し (単一 Emits ライフサイクル)
    let _ = emits.set_stage("complete").await;
    emits.complete().await;

    Ok(())
}
