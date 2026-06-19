//! Audio Extraction
//!
//! Extracts the audio track from a local MP4 file into MP3 (`.mp3`) or AAC
//! (`.m4a`) using ffmpeg. Independent of the Bilibili download pipeline: it
//! operates only on local files specified by absolute paths.

use crate::models::settings::AudioFormat;
use crate::utils::ffmpeg_probe::probe_duration_sec;
use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Event name for audio extraction progress updates emitted to the frontend.
const AUDIO_PROGRESS_EVENT: &str = "audio://progress";

/// Per-format ffmpeg arguments for the audio codec.
///
/// MP3 uses `libmp3lame`; M4a uses the native `aac` encoder inside an MP4
/// container. Both target a constant bitrate (`-b:a`) in kbps.
fn codec_args(format: AudioFormat, bitrate_kbps: u32) -> Vec<String> {
    let codec = match format {
        AudioFormat::Mp3 => "libmp3lame",
        AudioFormat::M4a => "aac",
    };
    vec![
        "-c:a".to_string(),
        codec.to_string(),
        "-b:a".to_string(),
        format!("{}k", bitrate_kbps),
    ]
}

/// Options for an audio extraction operation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOptions {
    /// Absolute path to the input `.mp4` file.
    pub input_path: String,
    /// Absolute path for the output file. Extension must match `format`.
    pub output_path: String,
    /// Target audio format.
    pub format: AudioFormat,
    /// Target bitrate in kbps (e.g. 128, 192, 256, 320).
    pub bitrate_kbps: u32,
}

/// Result of a successful audio extraction.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioResult {
    /// Absolute path of the written output file.
    pub output_path: String,
}

/// Progress payload emitted via {@link AUDIO_PROGRESS_EVENT} while ffmpeg runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProgressPayload {
    pub progress: f64,
    pub current_time_sec: f64,
    pub total_duration_sec: f64,
}

/// Builds the ffmpeg argument list for an audio extraction.
///
/// `-vn` discards the video stream so only audio is decoded and re-encoded.
/// `-progress pipe:2` emits structured `key=value` lines to stderr at 1-second
/// cadence so we can drive the progress bar from `out_time=`.
pub fn build_ffmpeg_args(options: &AudioOptions) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-nostats".to_string(),
        "-stats_period".to_string(),
        "1".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-i".to_string(),
        options.input_path.clone(),
        // Discard video; extract and re-encode the audio track only.
        "-vn".to_string(),
    ];
    args.extend(codec_args(options.format, options.bitrate_kbps));
    args.push("-y".to_string());
    args.push(options.output_path.clone());
    args
}

fn is_mp4(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
}

fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

/// Checks whether two paths refer to the same file on disk.
///
/// Mirrors the trim handler's logic: canonicalizes both paths to catch
/// symlinks, relative paths, and case differences. The output may not yet
/// exist, so its parent is canonicalized and the file name rejoined.
fn is_same_file(input: &Path, output: &Path) -> bool {
    let canon_input = std::fs::canonicalize(input).ok();
    let canon_output = std::fs::canonicalize(output).ok().or_else(|| {
        output
            .parent()
            .and_then(|p| std::fs::canonicalize(p).ok())
            .and_then(|p| output.file_name().map(|n| p.join(n)))
    });
    match (canon_input, canon_output) {
        (Some(a), Some(b)) => a == b,
        _ => input == output,
    }
}

/// Validates inputs and runs ffmpeg to produce the extracted audio file.
///
/// # Errors
///
/// Returns strings beginning with `ERR::AUDIO_*`:
/// - `ERR::AUDIO_INPUT_NOT_FOUND`
/// - `ERR::AUDIO_UNSUPPORTED_FORMAT` (input not `.mp4`)
/// - `ERR::AUDIO_UNSUPPORTED_OUTPUT_FORMAT` (extension does not match `format`)
/// - `ERR::AUDIO_SAME_PATH`
/// - `ERR::AUDIO_INVALID_BITRATE`
/// - `ERR::AUDIO_FFMPEG_FAILED`
pub async fn extract_audio(app: &AppHandle, options: &AudioOptions) -> Result<AudioResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::AUDIO_INPUT_NOT_FOUND".to_string());
    }
    if !is_mp4(input_path) {
        return Err("ERR::AUDIO_UNSUPPORTED_FORMAT".to_string());
    }
    let expected_ext = match options.format {
        AudioFormat::Mp3 => "mp3",
        AudioFormat::M4a => "m4a",
    };
    if !has_extension(output_path, expected_ext) {
        return Err("ERR::AUDIO_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    if is_same_file(input_path, output_path) {
        return Err("ERR::AUDIO_SAME_PATH".to_string());
    }
    if options.bitrate_kbps == 0 {
        return Err("ERR::AUDIO_INVALID_BITRATE".to_string());
    }

    let ffmpeg_path = get_ffmpeg_path(app);
    let args = build_ffmpeg_args(options);

    let total_duration_sec = probe_duration_sec(&ffmpeg_path, &options.input_path).await;

    let mut cmd = AsyncCommand::new(&ffmpeg_path);
    cmd.args(&args);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ERR::AUDIO_FFMPEG_FAILED: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::AUDIO_FFMPEG_FAILED: no stderr".to_string())?;

    let mut stderr_reader = BufReader::new(stderr);
    let app_for_progress = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut stderr_lines = String::new();
        let mut line = String::new();
        while stderr_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            stderr_lines.push_str(&line);

            if let Some(total) = total_duration_sec {
                if total > 0.0 {
                    if let Some(current) = parse_out_time(&line) {
                        let progress = (current / total * 100.0).clamp(0.0, 100.0);
                        let _ = app_for_progress.emit(
                            AUDIO_PROGRESS_EVENT,
                            AudioProgressPayload {
                                progress,
                                current_time_sec: current,
                                total_duration_sec: total,
                            },
                        );
                    }
                }
            }

            line.clear();
        }
        stderr_lines
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ERR::AUDIO_FFMPEG_FAILED: wait {e}"))?;

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ERR::AUDIO_FFMPEG_FAILED\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(AudioResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_mp3_uses_libmp3lame_and_bitrate() {
        let options = AudioOptions {
            input_path: "input.mp4".to_string(),
            output_path: "out.mp3".to_string(),
            format: AudioFormat::Mp3,
            bitrate_kbps: 192,
        };
        let args = build_ffmpeg_args(&options);
        assert!(args.contains(&"-vn".to_string()));
        assert!(args.contains(&"-c:a".to_string()));
        assert!(args.contains(&"libmp3lame".to_string()));
        assert!(args.contains(&"192k".to_string()));
        assert!(args.last().is_some_and(|a| a == "out.mp3"));
    }

    #[test]
    fn build_args_m4a_uses_aac() {
        let options = AudioOptions {
            input_path: "input.mp4".to_string(),
            output_path: "out.m4a".to_string(),
            format: AudioFormat::M4a,
            bitrate_kbps: 256,
        };
        let args = build_ffmpeg_args(&options);
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"256k".to_string()));
    }

    #[test]
    fn build_args_includes_progress_flags() {
        let options = AudioOptions {
            input_path: "input.mp4".to_string(),
            output_path: "out.mp3".to_string(),
            format: AudioFormat::Mp3,
            bitrate_kbps: 128,
        };
        let args = build_ffmpeg_args(&options);
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:2".to_string()));
    }

    #[test]
    fn is_mp4_checks_extension_case_insensitively() {
        assert!(is_mp4(Path::new("video.mp4")));
        assert!(is_mp4(Path::new("VIDEO.MP4")));
        assert!(!is_mp4(Path::new("video.mkv")));
    }
}
