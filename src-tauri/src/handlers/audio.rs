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

/// Pure pre-flight validation: format, extension-match and bitrate rules
/// that need no filesystem access. Split out of `extract_audio` so the
/// `ERR::AUDIO_*` branches are testable without spawning ffmpeg.
fn validate_formats(options: &AudioOptions) -> Result<(), String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

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
    Ok(())
}

/// Value checks that run AFTER the same-path guard, matching the original
/// inline validation order exactly (SAME_PATH wins over INVALID_BITRATE
/// when both are wrong).
fn validate_value(options: &AudioOptions) -> Result<(), String> {
    if options.bitrate_kbps == 0 {
        return Err("ERR::AUDIO_INVALID_BITRATE".to_string());
    }
    Ok(())
}

/// Computes the progress payload for one ffmpeg stderr line.
///
/// Split out of the stderr pump task in `extract_audio` so the
/// out_time -> percentage mapping is testable without a running process.
fn compute_progress(line: &str, total_duration_sec: f64) -> Option<AudioProgressPayload> {
    if total_duration_sec <= 0.0 {
        return None;
    }
    let current = parse_out_time(line)?;
    let progress = (current / total_duration_sec * 100.0).clamp(0.0, 100.0);
    Some(AudioProgressPayload {
        progress,
        current_time_sec: current,
        total_duration_sec,
    })
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
    extract_audio_with_ffmpeg(&get_ffmpeg_path(app), app, options).await
}

/// Path-injected split of [`extract_audio`] (test seam, issue #646): runs the
/// same validation→args→spawn→progress flow against an explicit ffmpeg
/// binary so tests drive it with a fake script in a tempdir.
// Why: generic over R, not the default-Wry `&AppHandle`, because the E2E tests
// below pass `tauri::test::mock_app().handle()` (`AppHandle<MockRuntime>`,
// tauri "test" feature in src-tauri/Cargo.toml), which only type-checks
// against a generic Runtime param (issue #646).
pub(crate) async fn extract_audio_with_ffmpeg<R: tauri::Runtime>(
    ffmpeg_path: &Path,
    app: &tauri::AppHandle<R>,
    options: &AudioOptions,
) -> Result<AudioResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::AUDIO_INPUT_NOT_FOUND".to_string());
    }
    validate_formats(options)?;
    if is_same_file(input_path, output_path) {
        return Err("ERR::AUDIO_SAME_PATH".to_string());
    }
    validate_value(options)?;

    let args = build_ffmpeg_args(options);

    let total_duration_sec = probe_duration_sec(ffmpeg_path, &options.input_path).await;

    let mut cmd = AsyncCommand::new(ffmpeg_path);
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

            if let Some(payload) =
                total_duration_sec.and_then(|total| compute_progress(&line, total))
            {
                let _ = app_for_progress.emit(AUDIO_PROGRESS_EVENT, payload);
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
    #[test]
    fn validate_formats_rejects_non_mp4_input() {
        let options = AudioOptions {
            input_path: "video.mkv".to_string(),
            output_path: "out.mp3".to_string(),
            format: AudioFormat::Mp3,
            bitrate_kbps: 192,
        };
        assert_eq!(
            validate_formats(&options).unwrap_err(),
            "ERR::AUDIO_UNSUPPORTED_FORMAT"
        );
    }

    #[test]
    fn validate_formats_output_extension_must_match_format() {
        let mismatched = AudioOptions {
            input_path: "video.mp4".to_string(),
            output_path: "out.mp3".to_string(),
            format: AudioFormat::M4a,
            bitrate_kbps: 192,
        };
        assert_eq!(
            validate_formats(&mismatched).unwrap_err(),
            "ERR::AUDIO_UNSUPPORTED_OUTPUT_FORMAT"
        );

        let matched = AudioOptions {
            output_path: "out.m4a".to_string(),
            ..mismatched
        };
        assert!(validate_formats(&matched).is_ok());
    }

    #[test]
    fn validate_value_rejects_zero_bitrate() {
        let options = AudioOptions {
            input_path: "video.mp4".to_string(),
            output_path: "out.mp3".to_string(),
            format: AudioFormat::Mp3,
            bitrate_kbps: 0,
        };
        assert_eq!(
            validate_value(&options).unwrap_err(),
            "ERR::AUDIO_INVALID_BITRATE"
        );
    }

    #[test]
    fn is_same_file_detects_identity_and_difference() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mp4");
        std::fs::write(&a, b"x").unwrap();
        let b = dir.path().join("b.mp3");

        assert!(is_same_file(&a, &a));
        assert!(
            is_same_file(&a, &dir.path().join("a.mp4")),
            "via parent join"
        );
        assert!(!is_same_file(&a, &b));
    }

    #[test]
    fn compute_progress_maps_and_clamps() {
        let p = compute_progress("out_time=00:00:15.000000", 60.0).unwrap();
        assert_eq!(p.progress, 25.0);
        assert_eq!(p.current_time_sec, 15.0);

        let overrun = compute_progress("out_time=00:02:00.000000", 60.0).unwrap();
        assert_eq!(overrun.progress, 100.0, "overrun clamps");

        assert!(compute_progress("out_time=00:00:15.000000", 0.0).is_none());
        assert!(compute_progress("frame=  10 fps=25", 60.0).is_none());
    }

    #[test]
    fn progress_payload_serializes_camel_case() {
        let json = serde_json::to_value(AudioProgressPayload {
            progress: 10.0,
            current_time_sec: 6.0,
            total_duration_sec: 60.0,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"progress": 10.0, "currentTimeSec": 6.0, "totalDurationSec": 60.0})
        );
    }

    // ---- PR⑧: executor E2E (issue #646) ----
    //
    // The fake ffmpeg writes a sentinel to the output path on success, so
    // assertions target the file, never stderr (PR #619/#624 flake lesson).

    #[cfg(unix)]
    use crate::utils::ffmpeg_probe::write_fake_ffmpeg_executor;

    fn audio_options(input: &str, output: &str) -> AudioOptions {
        AudioOptions {
            input_path: input.to_string(),
            output_path: output.to_string(),
            format: AudioFormat::Mp3,
            bitrate_kbps: 192,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn extract_audio_with_ffmpeg_writes_output_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 0, false);
        let input = dir.path().join("in.mp4");
        std::fs::write(&input, b"input").unwrap();
        let output = dir.path().join("out.mp3");

        let app = tauri::test::mock_app();
        let result = extract_audio_with_ffmpeg(
            &ffmpeg,
            app.handle(),
            &audio_options(&input.to_string_lossy(), &output.to_string_lossy()),
        )
        .await
        .unwrap();

        assert_eq!(result.output_path, output.to_string_lossy());
        assert_eq!(std::fs::read(&output).unwrap(), b"fake-ffmpeg-output\n");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn extract_audio_with_ffmpeg_maps_failure_to_err_code() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 1, false);
        let input = dir.path().join("in.mp4");
        std::fs::write(&input, b"input").unwrap();
        let output = dir.path().join("out.mp3");

        let app = tauri::test::mock_app();
        let err = extract_audio_with_ffmpeg(
            &ffmpeg,
            app.handle(),
            &audio_options(&input.to_string_lossy(), &output.to_string_lossy()),
        )
        .await
        .unwrap_err();
        assert!(err.starts_with("ERR::AUDIO_FFMPEG_FAILED"), "got: {err}");
    }
}
