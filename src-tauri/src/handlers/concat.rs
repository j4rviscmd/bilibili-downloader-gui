//! Video Concatenation
//!
//! Concatenates multiple MP4 files into one using ffmpeg's concat demuxer.
//! First attempts stream copy (fast, lossless). If that fails due to
//! incompatible codecs/resolutions, automatically retries with re-encoding.

use crate::utils::ffmpeg_probe::probe_duration_sec;
use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

const CONCAT_PROGRESS_EVENT: &str = "concat://progress";
const CONCAT_FALLBACK_EVENT: &str = "concat://fallback";

/// Options for the video concatenation command.
///
/// Serialized from the frontend via `serde(rename_all = "camelCase")`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatOptions {
    /// Absolute file paths of the MP4 videos to concatenate, in order.
    pub input_paths: Vec<String>,
    /// Absolute file path for the output MP4 file.
    pub output_path: String,
}

/// Result returned on successful video concatenation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatResult {
    /// Absolute file path of the concatenated output video.
    pub output_path: String,
}

/// Payload emitted via Tauri events to report concatenation progress.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatProgressPayload {
    /// Concatenation progress as a percentage (0.0 to 100.0).
    pub progress: f64,
    /// Current processing time in seconds.
    pub current_time_sec: f64,
    /// Total duration of all input files combined, in seconds.
    pub total_duration_sec: f64,
}

/// Returns `true` if the file extension is `.mp4` (case-insensitive).
fn is_mp4(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp4"))
}

/// Compares two paths for equality, preferring canonicalized forms when
/// available. Falls back to lexical comparison if either path cannot be
/// canonicalized (e.g. the output file does not yet exist).
fn is_same_file(a: &Path, b: &Path) -> bool {
    let cb = std::fs::canonicalize(b)
        .ok()
        .or_else(|| canonicalize_with_parent(b));
    match (std::fs::canonicalize(a).ok(), cb) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

/// Canonicalizes the parent directory and rejoins the file name. Used when
/// `b` does not exist yet (e.g. an output path that hasn't been written).
fn canonicalize_with_parent(path: &Path) -> Option<std::path::PathBuf> {
    let parent = path.parent()?;
    let canon = std::fs::canonicalize(parent).ok()?;
    path.file_name().map(|n| canon.join(n))
}

/// Builds ffmpeg arguments for stream-copy concatenation.
///
/// Uses the concat demuxer with `-c copy` for a fast, lossless merge.
fn build_concat_copy_args(list_path: &str, output_path: &str) -> Vec<String> {
    [
        "-nostats",
        "-stats_period",
        "1",
        "-progress",
        "pipe:2",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_path,
        "-c",
        "copy",
        "-y",
        output_path,
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// Builds ffmpeg arguments for re-encode concatenation.
///
/// Falls back to this when stream copy fails due to incompatible
/// codecs or resolutions. Uses libx264 (CRF 23) and AAC 192k.
fn build_concat_reencode_args(list_path: &str, output_path: &str) -> Vec<String> {
    [
        "-nostats",
        "-stats_period",
        "1",
        "-progress",
        "pipe:2",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_path,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-y",
        output_path,
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// Creates a temporary file listing input paths for ffmpeg's concat demuxer.
fn write_concat_list(input_paths: &[String]) -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("bilibili-dl-concat");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("ERR::CONCAT_FFMPEG_FAILED: create temp dir {e}"))?;

    let list_path = dir.join(format!(
        "filelist_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    let content = input_paths
        .iter()
        .map(|p| {
            let escaped = p.replace('\\', "/").replace("'", "'\\''");
            format!("file '{escaped}'")
        })
        .collect::<Vec<_>>()
        .join("\n");

    std::fs::write(&list_path, content)
        .map_err(|e| format!("ERR::CONCAT_FFMPEG_FAILED: write filelist {e}"))?;

    Ok(list_path)
}

/// Removes the temporary concat list file and its parent directory
/// (`bilibili-dl-concat`) if empty.
fn cleanup_list(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    if let Some(parent) = path.parent() {
        if parent
            .file_name()
            .is_some_and(|n| n == "bilibili-dl-concat")
        {
            let _ = std::fs::remove_dir(parent);
        }
    }
}

/// Runs ffmpeg with the given args, emitting progress events.
/// Returns the full stderr output on success, or an error string on failure.
async fn run_ffmpeg_with_progress(
    app: &AppHandle,
    ffmpeg_path: &Path,
    args: &[String],
    total_duration_sec: Option<f64>,
    error_prefix: &str,
) -> Result<String, String> {
    let mut cmd = AsyncCommand::new(ffmpeg_path);
    cmd.args(args);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{error_prefix}: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{error_prefix}: no stderr"))?;

    let mut reader = BufReader::new(stderr);
    let app_clone = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut stderr_output = String::new();
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            stderr_output.push_str(&line);

            if let Some(total) = total_duration_sec.filter(|t| *t > 0.0) {
                if let Some(current) = parse_out_time(&line) {
                    let progress = (current / total * 100.0).clamp(0.0, 100.0);
                    let _ = app_clone.emit(
                        CONCAT_PROGRESS_EVENT,
                        ConcatProgressPayload {
                            progress,
                            current_time_sec: current,
                            total_duration_sec: total,
                        },
                    );
                }
            }

            line.clear();
        }
        stderr_output
    });

    let status = match child.wait().await {
        Ok(s) => s,
        Err(e) => {
            stderr_task.abort();
            return Err(format!("{error_prefix}: wait {e}"));
        }
    };

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "{error_prefix}\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(stderr_output)
}

/// Validates inputs and output paths, returning an `ERR::*` code on failure.
fn validate_inputs(input_paths: &[String], output_path: &Path) -> Result<(), String> {
    if input_paths.len() < 2 {
        return Err("ERR::CONCAT_TOO_FEW_FILES".to_string());
    }
    for p in input_paths {
        let path = Path::new(p);
        if !path.exists() {
            return Err("ERR::CONCAT_FILE_NOT_FOUND".to_string());
        }
        if !is_mp4(path) {
            return Err("ERR::CONCAT_UNSUPPORTED_FORMAT".to_string());
        }
        if is_same_file(path, output_path) {
            return Err("ERR::CONCAT_OUTPUT_COLLISION".to_string());
        }
    }
    if !is_mp4(output_path) {
        return Err("ERR::CONCAT_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    Ok(())
}

/// Concatenates multiple MP4 video files into a single output file.
///
/// First attempts stream copy (fast, lossless). If that fails due to
/// incompatible codecs/resolutions, automatically retries with re-encoding
/// and emits a `concat://fallback` event to notify the frontend.
///
/// Progress is reported via `concat://progress` events containing a
/// [`ConcatProgressPayload`].
///
/// # Arguments
///
/// * `app` - Tauri application handle, used for emitting events and
///   resolving the ffmpeg binary path.
/// * `options` - Concatenation options including input paths and output path.
///
/// # Errors
///
/// Returns an `ERR::*`-prefixed error string on validation failure,
/// ffmpeg spawn failure, or when both copy and re-encode attempts fail.
pub async fn concat_videos(
    app: &AppHandle,
    options: &ConcatOptions,
) -> Result<ConcatResult, String> {
    let output_path = Path::new(&options.output_path);

    validate_inputs(&options.input_paths, output_path)?;

    let ffmpeg_path = get_ffmpeg_path(app);

    // Probe total duration across all input files
    let mut total_duration: f64 = 0.0;
    for p in &options.input_paths {
        if let Some(d) = probe_duration_sec(&ffmpeg_path, p).await {
            total_duration += d;
        }
    }
    let total_duration = (total_duration > 0.0).then_some(total_duration);

    let list_path = write_concat_list(&options.input_paths)?;
    let list_str = list_path.to_str().unwrap_or_default().to_string();
    let output_str = options.output_path.clone();

    // Try stream copy first; fall back to re-encode on failure.
    let copy_args = build_concat_copy_args(&list_str, &output_str);
    let copy_result = run_ffmpeg_with_progress(
        app,
        &ffmpeg_path,
        &copy_args,
        total_duration,
        "ERR::CONCAT_FFMPEG_FAILED",
    )
    .await;

    if copy_result.is_ok() {
        cleanup_list(&list_path);
        return Ok(ConcatResult {
            output_path: options.output_path.clone(),
        });
    }

    // Notify frontend that we're falling back to re-encode
    let _ = app.emit(CONCAT_FALLBACK_EVENT, ());
    let _ = app.emit(
        CONCAT_PROGRESS_EVENT,
        ConcatProgressPayload {
            progress: 0.0,
            current_time_sec: 0.0,
            total_duration_sec: 0.0,
        },
    );

    let reencode_args = build_concat_reencode_args(&list_str, &output_str);
    let reencode_result = run_ffmpeg_with_progress(
        app,
        &ffmpeg_path,
        &reencode_args,
        total_duration,
        "ERR::CONCAT_REENCODE_FAILED",
    )
    .await;

    cleanup_list(&list_path);

    reencode_result.map(|_| ConcatResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_concat_copy_args_structure() {
        let args = build_concat_copy_args("/tmp/list.txt", "out.mp4");
        assert!(args.contains(&"-f".to_string()));
        assert!(args.contains(&"concat".to_string()));
        assert!(args.contains(&"-safe".to_string()));
        assert!(args.contains(&"0".to_string()));
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&"-y".to_string()));
        assert!(args.last().is_some_and(|a| a == "out.mp4"));
    }

    #[test]
    fn build_concat_reencode_args_structure() {
        let args = build_concat_reencode_args("/tmp/list.txt", "out.mp4");
        assert!(args.contains(&"-f".to_string()));
        assert!(args.contains(&"concat".to_string()));
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"-c:a".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(
            !args.contains(&"-c".to_string()) || args.iter().any(|a| a == "-c:v" || a == "-c:a")
        );
    }

    #[test]
    fn is_mp4_checks_extension() {
        assert!(is_mp4(Path::new("video.mp4")));
        assert!(is_mp4(Path::new("VIDEO.MP4")));
        assert!(!is_mp4(Path::new("video.mkv")));
    }

    #[test]
    fn write_concat_list_content() {
        let list = write_concat_list(&[
            "C:\\Videos\\a.mp4".to_string(),
            "D:\\clips\\b's file.mp4".to_string(),
        ])
        .unwrap();

        let content = std::fs::read_to_string(&list).unwrap();
        assert!(content.contains("file 'C:/Videos/a.mp4'"));
        assert!(content.contains("file 'D:/clips/b'\\''s file.mp4'"));

        cleanup_list(&list);
    }
}
