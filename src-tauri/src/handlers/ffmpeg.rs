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
    if !ffmpeg_root.exists() {
        return false;
    }
    if !ffmpeg_path.exists() {
        cleanup_ffmpeg_dir(&ffmpeg_root);
        return false;
    }

    if !validate_command(&ffmpeg_path) {
        cleanup_ffmpeg_dir(&ffmpeg_root);
        return false;
    }

    true
}

/// Removes the ffmpeg root directory if it exists.
fn cleanup_ffmpeg_dir(ffmpeg_root: &PathBuf) {
    if ffmpeg_root.is_dir() {
        fs::remove_dir_all(ffmpeg_root).ok();
    } else if ffmpeg_root.is_file() {
        fs::remove_file(ffmpeg_root).ok();
    }
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

    // Download URL and filename based on platform
    let (url, filename) = if cfg!(target_os = "windows") {
        (
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip",
            "ffmpeg-master-latest-win64-lgpl-shared.zip",
        )
    } else if cfg!(target_os = "macos") {
        ("https://evermeet.cx/ffmpeg/getrelease/zip", "ffmpeg.zip")
    } else {
        return Ok(false);
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
    let _ = fs::remove_file(&archive_path);

    // Grant execute permission on macOS
    #[cfg(target_os = "macos")]
    {
        let ffmpeg_bin = ffmpeg_root.join("ffmpeg");
        let Some(ffmpeg_path_str) = ffmpeg_bin.to_str() else {
            return Err(anyhow::anyhow!("Invalid ffmpeg path").into());
        };
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

/// Builds the ffmpeg binary path for the current platform.
///
/// # Arguments
///
/// * `base_path` - The root directory containing ffmpeg
///
/// # Returns
///
/// Returns the full path to the ffmpeg binary (with .exe extension on Windows).
fn build_ffmpeg_bin_path(base_path: &PathBuf) -> PathBuf {
    let mut path = if cfg!(target_os = "windows") {
        base_path
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("bin")
            .join("ffmpeg")
    } else {
        base_path.join("ffmpeg")
    };
    if cfg!(target_os = "windows") {
        path.set_extension("exe");
    }
    path
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

/// Moves ffmpeg from one location to another with validation.
///
/// This function:
/// 1. Creates the target directory if needed
/// 2. Copies the entire ffmpeg directory to the new location
/// 3. Validates the copied ffmpeg binary
/// 4. Removes the old directory on successful validation
/// 5. Cleans up the new directory on validation failure
///
/// **Always overwrites** the target if ffmpeg exists there.
///
/// # Arguments
///
/// * `from_path` - Current ffmpeg root directory path
/// * `to_path` - New ffmpeg root directory path
///
/// # Returns
///
/// Returns `Ok(())` on successful move and validation.
///
/// # Errors
///
/// Returns an error if:
/// - Source ffmpeg doesn't exist or is invalid
/// - Directory creation fails
/// - Copy operation fails
/// - Validation fails (new path is cleaned up)
pub fn move_ffmpeg(from_path: PathBuf, to_path: PathBuf) -> Result<(), String> {
    // Validate source ffmpeg
    if !from_path.exists() {
        return Err(format!(
            "Source ffmpeg directory does not exist: {:?}",
            from_path
        ));
    }

    let ffmpeg_bin = build_ffmpeg_bin_path(&from_path);

    if !ffmpeg_bin.exists() {
        return Err(format!("Source ffmpeg binary not found: {:?}", ffmpeg_bin));
    }

    if !validate_command(&ffmpeg_bin) {
        return Err(format!(
            "Source ffmpeg binary is not valid: {:?}",
            ffmpeg_bin
        ));
    }

    // Create target directory (remove existing if present)
    if to_path.exists() {
        fs::remove_dir_all(&to_path)
            .map_err(|e| format!("Failed to remove existing target directory: {}", e))?;
    }
    fs::create_dir_all(&to_path)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    // Copy entire directory recursively
    copy_dir_recursive(&from_path, &to_path)
        .map_err(|e| format!("Failed to copy ffmpeg directory: {}", e))?;

    // Validate the copied ffmpeg
    let new_ffmpeg_bin = build_ffmpeg_bin_path(&to_path);

    if !validate_command(&new_ffmpeg_bin) {
        // Validation failed - clean up the new directory
        let _ = fs::remove_dir_all(&to_path);
        return Err(format!(
            "Copied ffmpeg binary validation failed: {:?}",
            new_ffmpeg_bin
        ));
    }

    // Remove old directory on success
    fs::remove_dir_all(&from_path)
        .map_err(|e| format!("Failed to remove old ffmpeg directory: {}", e))?;

    Ok(())
}

/// Recursively copies a directory to another location.
///
/// # Arguments
///
/// * `from` - Source directory path
/// * `to` - Target directory path
///
/// # Returns
///
/// Returns `Ok(())` on successful copy.
///
/// # Errors
///
/// Returns an error if file/directory operations fail.
fn copy_dir_recursive(from: &PathBuf, to: &PathBuf) -> std::io::Result<()> {
    if from.is_dir() {
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            let from_path = entry.path();
            let to_path = to.join(entry.file_name());

            if from_path.is_dir() {
                fs::create_dir_all(&to_path)?;
                copy_dir_recursive(&from_path, &to_path)?;
            } else {
                fs::copy(&from_path, &to_path)?;
            }
        }
    }
    Ok(())
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
    let emits = Emits::new(
        app.clone(),
        download_id.unwrap_or(filename.to_string()),
        None,
    );
    let _ = emits.set_stage("merge").await;

    let ffmpeg_path = get_ffmpeg_path(app);

    // Convert paths to strings for ffmpeg command
    let to_str_err = || "Invalid path".to_string();
    let video_str = video_path.to_str().ok_or_else(to_str_err)?;
    let audio_str = audio_path.to_str().ok_or_else(to_str_err)?;
    let output_str = output_path.to_str().ok_or_else(to_str_err)?;

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
