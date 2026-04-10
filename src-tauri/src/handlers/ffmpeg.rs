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
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Options for embedding subtitles during video merging.
///
/// Used by [`merge_avs`] to specify subtitle file path, language code,
/// and display title for each subtitle track.
#[derive(Debug, Clone, PartialEq)]
pub struct SubtitleMergeOptions {
    /// Absolute path to the subtitle file (e.g., `.srt` or `.ass`).
    pub path: PathBuf,
    /// ISO 639-2 language code (e.g., `"eng"`, `"jpn"`, `"chi"`).
    pub language: String,
    /// Human-readable track title displayed in media players (e.g., `"English"`).
    pub title: String,
}

/// Specifies how subtitles should be merged into the output video.
///
/// This enum controls the subtitle handling strategy during the ffmpeg merge
/// process performed by [`merge_avs`].
#[derive(Debug, Clone, PartialEq)]
pub enum MergeMode {
    /// No subtitles; merges video and audio streams only (equivalent to [`merge_av`]).
    None,
    /// Soft subtitles: embeds subtitle tracks into the container without re-encoding.
    ///
    /// Viewers can toggle subtitle visibility during playback.
    /// Multiple subtitle tracks are supported.
    SoftSub(Vec<SubtitleMergeOptions>),
    /// Hard subtitles: burns subtitles into the video frame via re-encoding.
    ///
    /// Subtitles are always visible and cannot be toggled off.
    /// Uses `libx264` with `fast` preset for encoding.
    HardSub(SubtitleMergeOptions),
}

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
    log::info!("[BE] validate_ffmpeg: checking ffmpeg installation");
    let ffmpeg_root = get_ffmpeg_root_path(app);
    let ffmpeg_path = get_ffmpeg_path(app);
    if !ffmpeg_root.exists() {
        log::info!("[BE] validate_ffmpeg: ffmpeg root directory not found");
        return false;
    }
    if !ffmpeg_path.exists() {
        log::warn!("[BE] validate_ffmpeg: ffmpeg binary not found, cleaning up");
        cleanup_ffmpeg_dir(&ffmpeg_root);
        return false;
    }

    if !validate_command(&ffmpeg_path) {
        log::warn!("[BE] validate_ffmpeg: ffmpeg binary validation failed, cleaning up");
        cleanup_ffmpeg_dir(&ffmpeg_root);
        return false;
    }

    log::info!("[BE] validate_ffmpeg: ffmpeg is valid");
    true
}

/// Removes the ffmpeg root directory or file if it exists.
fn cleanup_ffmpeg_dir(ffmpeg_root: &Path) {
    if ffmpeg_root.is_dir() {
        let _ = fs::remove_dir_all(ffmpeg_root);
    } else if ffmpeg_root.is_file() {
        let _ = fs::remove_file(ffmpeg_root);
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
    log::info!("[BE] install_ffmpeg: starting ffmpeg installation");
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
    } else if cfg!(target_os = "linux") {
        (
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz",
            "ffmpeg-master-latest-linux64-lgpl.tar.xz",
        )
    } else {
        return Ok(false);
    };
    // ~/bilibili-downloader-gui/src-tauri/target/debug/lib/ffmpeg
    let archive_path = ffmpeg_root.join(filename);
    if download_url(
        app,
        url.to_string(),
        None,
        archive_path.clone(),
        None,
        true,
        None,
        None,
        false, // emit_complete: ffmpeg download has no progress UI
    )
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

    // Grant execute permission on Unix (macOS and Linux)
    #[cfg(unix)]
    {
        let ffmpeg_bin = get_ffmpeg_path(app);
        let Some(ffmpeg_path_str) = ffmpeg_bin.to_str() else {
            return Err(anyhow::anyhow!("Invalid ffmpeg path"));
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
async fn unpack_archive(archive_path: &Path, dest: &Path) -> Result<bool> {
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
fn build_ffmpeg_bin_path(base_path: &Path) -> PathBuf {
    let mut path = if cfg!(target_os = "windows") {
        base_path
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("bin")
            .join("ffmpeg")
    } else if cfg!(target_os = "linux") {
        base_path
            .join("ffmpeg-master-latest-linux64-lgpl")
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
fn validate_command(path: &Path) -> bool {
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
fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
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
/// Delegates to [`merge_avs`] with [`MergeMode::None`].
/// See [`merge_avs`] for detailed documentation on arguments, return values, and errors.
pub async fn merge_av(
    app: &AppHandle,
    video_path: &std::path::Path,
    audio_path: &std::path::Path,
    output_path: &std::path::Path,
    download_id: Option<String>,
    duration_ms: Option<u64>,
) -> Result<(), String> {
    merge_avs(
        app,
        video_path,
        audio_path,
        output_path,
        download_id,
        duration_ms,
        MergeMode::None,
    )
    .await
}

/// Merges video, audio, and optional subtitles into a single MP4 file.
///
/// This is an extended version of [`merge_av`] that supports subtitle handling
/// based on the specified [`MergeMode`]:
///
/// - **None**: Merges video and audio only (identical to [`merge_av`]).
///   Video stream is copied without re-encoding; audio is re-encoded to AAC.
/// - **SoftSub**: Embeds subtitle tracks into the container (`mov_text` codec).
///   Viewers can toggle subtitles on/off during playback. Supports multiple tracks.
/// - **HardSub**: Burns subtitles into the video frame using the `subtitles` filter.
///   Requires re-encoding via `libx264` with `fast` preset.
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
/// * `duration_ms` - Optional video duration in milliseconds for accurate progress
/// * `subtitle_mode` - Controls how subtitles are handled during the merge
///
/// # Returns
///
/// Returns `Ok(())` on successful merge.
///
/// # Errors
///
/// Returns an error if:
/// - File paths contain invalid UTF-8
/// - Subtitle file paths are invalid (when using SoftSub or HardSub mode)
/// - ffmpeg execution fails
/// - ffmpeg returns a non-zero exit code
pub async fn merge_avs(
    app: &AppHandle,
    video_path: &std::path::Path,
    audio_path: &std::path::Path,
    output_path: &std::path::Path,
    download_id: Option<String>,
    duration_ms: Option<u64>,
    subtitle_mode: MergeMode,
) -> Result<(), String> {
    log::info!(
        "[BE] merge_avs: starting merge download_id={:?}, output={:?}, subtitle_mode={:?}",
        download_id,
        output_path,
        subtitle_mode
    );
    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let emits = Emits::new(
        app.clone(),
        download_id.unwrap_or(filename.to_string()),
        Some(100 * 1024 * 1024),
    );
    let _ = emits.set_stage("merge").await;

    let ffmpeg_path = get_ffmpeg_path(app);

    let to_str_err = || "Invalid path".to_string();
    let video_str = video_path.to_str().ok_or_else(to_str_err)?;
    let audio_str = audio_path.to_str().ok_or_else(to_str_err)?;
    let output_str = output_path.to_str().ok_or_else(to_str_err)?;

    let mut cmd = AsyncCommand::new(&ffmpeg_path);

    match &subtitle_mode {
        MergeMode::None => {
            cmd.args([
                "-i",
                video_str,
                "-i",
                audio_str,
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-progress",
                "pipe:1",
                "-y",
                output_str,
            ]);
        }
        MergeMode::SoftSub(subtitles) => {
            let mut input_args: Vec<String> = vec![
                "-i".to_string(),
                video_str.to_string(),
                "-i".to_string(),
                audio_str.to_string(),
            ];

            for sub in subtitles {
                let sub_str = sub.path.to_str().ok_or_else(to_str_err)?;
                input_args.push("-i".to_string());
                input_args.push(sub_str.to_string());
            }

            let sub_count = subtitles.len();

            let mut map_args: Vec<String> = vec![
                "-map".to_string(),
                "0:v".to_string(),
                "-map".to_string(),
                "1:a".to_string(),
            ];

            for i in 0..sub_count {
                map_args.push("-map".to_string());
                map_args.push(format!("{}:0", i + 2));
            }

            let mut metadata_args: Vec<String> = Vec::new();
            for (i, sub) in subtitles.iter().enumerate() {
                metadata_args.push(format!("-metadata:s:s:{}", i));
                metadata_args.push(format!("language={}", sub.language));
                metadata_args.push(format!("-metadata:s:s:{}", i));
                metadata_args.push(format!("title={}", sub.title));
            }

            let codec_args: Vec<String> = vec![
                "-c:v".to_string(),
                "copy".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-c:s".to_string(),
                "mov_text".to_string(),
            ];

            cmd.args(&input_args)
                .args(&map_args)
                .args(&metadata_args)
                .args(&codec_args)
                .args(["-progress", "pipe:1", "-y", output_str]);
        }
        MergeMode::HardSub(subtitle) => {
            let sub_str = subtitle.path.to_str().ok_or_else(to_str_err)?;

            let escaped_sub = sub_str
                .replace('\\', "\\\\")
                .replace(':', "\\:")
                .replace('\'', "'\\''");

            let filter = format!("subtitles='{}'", escaped_sub);

            cmd.args([
                "-i",
                video_str,
                "-i",
                audio_str,
                "-vf",
                &filter,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-c:a",
                "aac",
                "-progress",
                "pipe:1",
                "-y",
                output_str,
            ]);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    let stdout = child.stdout.as_mut().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut stderr_reader = BufReader::new(stderr);
    let mut stderr_lines = String::new();
    let stderr_task = tokio::spawn(async move {
        let mut line = String::new();
        while stderr_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            stderr_lines.push_str(&line);
            line.clear();
        }
        stderr_lines
    });

    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(time_str) = line.strip_prefix("out_time_ms=") {
            let out_time_us: u64 = time_str.trim().parse().unwrap_or(0);
            let out_time_ms = out_time_us / 1000;

            let total_duration_ms = duration_ms.unwrap_or(300_000);
            let percentage = if total_duration_ms > 0 {
                (out_time_ms as f64 / total_duration_ms as f64) * 100.0
            } else {
                0.0
            };

            let clamped_percentage = percentage.min(95.0);
            emits.update_progress((clamped_percentage as u64) * 1024 * 1024);
        }

        if line == "progress=end" {
            break;
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for ffmpeg: {e}"))?;

    let stderr_output = stderr_task
        .await
        .unwrap_or_else(|e| format!("Failed to read stderr: {e}"));

    if !status.success() {
        return Err(format!(
            "ffmpeg failed to merge.\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    let _ = emits.set_stage("complete").await;
    emits.complete().await;

    Ok(())
}
