//! Resolution Conversion
//!
//! Downscale video resolution using ffmpeg scale filter. Independent of the
//! Bilibili download pipeline: it operates only on local files specified by
//! absolute paths.

use crate::utils::ffmpeg_probe::probe_duration_sec;
use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Event name for resolution conversion progress updates emitted to the frontend.
const RESOLUTION_PROGRESS_EVENT: &str = "resolution://progress";

/// Options for a resolution conversion operation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionOptions {
    /// Absolute path to the input `.mp4` file.
    pub input_path: String,
    /// Absolute path for the output file. Must be `.mp4`.
    pub output_path: String,
    /// Target height (e.g. 1080, 720, 480, 360). Width is auto-calculated
    /// via ffmpeg's `scale=-2:H` filter.
    pub target_height: u32,
}

/// Result of a successful resolution conversion.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionResult {
    /// Absolute path of the written output file.
    pub output_path: String,
}

/// Progress payload emitted via {@link RESOLUTION_PROGRESS_EVENT} while ffmpeg runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionProgressPayload {
    pub progress: f64,
    pub current_time_sec: f64,
    pub total_duration_sec: f64,
}

/// Builds the ffmpeg argument list for a resolution conversion.
///
/// Uses `scale=-2:H` filter to auto-calculate width based on the target height
/// while preserving aspect ratio. `-crf 23` for constant quality. `-c:a copy`
/// preserves the original audio track without re-encoding.
pub fn build_ffmpeg_args(options: &ResolutionOptions) -> Vec<String> {
    vec![
        "-nostats".to_string(),
        "-stats_period".to_string(),
        "1".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-i".to_string(),
        options.input_path.clone(),
        "-vf".to_string(),
        format!("scale=-2:{}", options.target_height),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-preset".to_string(),
        "medium".to_string(),
        "-c:a".to_string(),
        "copy".to_string(),
        "-y".to_string(),
        options.output_path.clone(),
    ]
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

/// Pure pre-flight validation: format and height rules that need no
/// filesystem access. Split out of `extract_resolution` so the
/// `ERR::RESOLUTION_*` branches are testable without spawning ffmpeg.
fn validate_formats(options: &ResolutionOptions) -> Result<(), String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !is_mp4(input_path) {
        return Err("ERR::RESOLUTION_UNSUPPORTED_FORMAT".to_string());
    }
    if !has_extension(output_path, "mp4") {
        return Err("ERR::RESOLUTION_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    Ok(())
}

/// Value checks that run AFTER the same-path guard, matching the original
/// inline validation order exactly (SAME_PATH wins over INVALID_HEIGHT
/// when both are wrong).
fn validate_value(options: &ResolutionOptions) -> Result<(), String> {
    // libx264's default yuv420p requires even dimensions; `scale=-2:H`
    // guarantees an even width but not height, so reject odd heights and
    // enforce the same 120-4320 range the UI advertises.
    if options.target_height < 120
        || options.target_height > 4320
        || !options.target_height.is_multiple_of(2)
    {
        return Err("ERR::RESOLUTION_INVALID_HEIGHT".to_string());
    }
    Ok(())
}

/// Computes the progress payload for one ffmpeg stderr line.
///
/// Split out of the stderr pump task in `extract_resolution` so the
/// out_time -> percentage mapping is testable without a running process.
fn compute_progress(line: &str, total_duration_sec: f64) -> Option<ResolutionProgressPayload> {
    let total = total_duration_sec;
    if total <= 0.0 {
        return None;
    }
    let current = parse_out_time(line)?;
    let progress = (current / total * 100.0).clamp(0.0, 100.0);
    Some(ResolutionProgressPayload {
        progress,
        current_time_sec: current,
        total_duration_sec: total,
    })
}

/// Validates inputs and runs ffmpeg to produce the downscaled video file.
///
/// # Errors
///
/// Returns strings beginning with `ERR::RESOLUTION_*`:
/// - `ERR::RESOLUTION_INPUT_NOT_FOUND`
/// - `ERR::RESOLUTION_UNSUPPORTED_FORMAT` (input not `.mp4`)
/// - `ERR::RESOLUTION_UNSUPPORTED_OUTPUT_FORMAT` (output not `.mp4`)
/// - `ERR::RESOLUTION_SAME_PATH`
/// - `ERR::RESOLUTION_INVALID_HEIGHT`
/// - `ERR::RESOLUTION_FFMPEG_FAILED`
pub async fn extract_resolution(
    app: &AppHandle,
    options: &ResolutionOptions,
) -> Result<ResolutionResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::RESOLUTION_INPUT_NOT_FOUND".to_string());
    }
    validate_formats(options)?;
    if is_same_file(input_path, output_path) {
        return Err("ERR::RESOLUTION_SAME_PATH".to_string());
    }
    validate_value(options)?;

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
        .map_err(|e| format!("ERR::RESOLUTION_FFMPEG_FAILED: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::RESOLUTION_FFMPEG_FAILED: no stderr".to_string())?;

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
                let _ = app_for_progress.emit(RESOLUTION_PROGRESS_EVENT, payload);
            }

            line.clear();
        }
        stderr_lines
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ERR::RESOLUTION_FFMPEG_FAILED: wait {e}"))?;

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ERR::RESOLUTION_FFMPEG_FAILED\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(ResolutionResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_uses_scale_filter_and_crf() {
        let options = ResolutionOptions {
            input_path: "input.mp4".to_string(),
            output_path: "output.mp4".to_string(),
            target_height: 720,
        };
        let args = build_ffmpeg_args(&options);
        assert!(args.contains(&"-vf".to_string()));
        assert!(args.contains(&"scale=-2:720".to_string()));
        assert!(args.contains(&"-crf".to_string()));
        assert!(args.contains(&"23".to_string()));
        assert!(args.contains(&"-c:a".to_string()));
        assert!(args.contains(&"copy".to_string()));
    }

    #[test]
    fn build_args_includes_progress_flags() {
        let options = ResolutionOptions {
            input_path: "input.mp4".to_string(),
            output_path: "output.mp4".to_string(),
            target_height: 480,
        };
        let args = build_ffmpeg_args(&options);
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:2".to_string()));
    }
    #[test]
    fn validate_formats_rejects_non_mp4_input() {
        let options = ResolutionOptions {
            input_path: "video.mkv".to_string(),
            output_path: "out.mp4".to_string(),
            target_height: 720,
        };
        assert_eq!(
            validate_formats(&options).unwrap_err(),
            "ERR::RESOLUTION_UNSUPPORTED_FORMAT"
        );
    }

    #[test]
    fn validate_formats_rejects_non_mp4_output() {
        let options = ResolutionOptions {
            input_path: "video.mp4".to_string(),
            output_path: "out.mkv".to_string(),
            target_height: 720,
        };
        assert_eq!(
            validate_formats(&options).unwrap_err(),
            "ERR::RESOLUTION_UNSUPPORTED_OUTPUT_FORMAT"
        );
    }

    #[test]
    fn validate_value_enforces_even_height_in_range() {
        let mk = |h: u32| ResolutionOptions {
            input_path: "video.mp4".to_string(),
            output_path: "out.mp4".to_string(),
            target_height: h,
        };
        assert!(validate_value(&mk(120)).is_ok());
        assert!(validate_value(&mk(4320)).is_ok());
        assert_eq!(
            validate_value(&mk(119)).unwrap_err(),
            "ERR::RESOLUTION_INVALID_HEIGHT",
            "below 120"
        );
        assert_eq!(
            validate_value(&mk(4322)).unwrap_err(),
            "ERR::RESOLUTION_INVALID_HEIGHT",
            "above 4320"
        );
        assert_eq!(
            validate_value(&mk(721)).unwrap_err(),
            "ERR::RESOLUTION_INVALID_HEIGHT",
            "odd height breaks yuv420p"
        );
    }

    #[test]
    fn is_same_file_detects_identity_and_difference() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mp4");
        std::fs::write(&a, b"x").unwrap();
        let b = dir.path().join("b.mp4");

        assert!(is_same_file(&a, &a), "identical path");
        // Output does not exist yet: parent canonicalized + rejoin equals input
        assert!(
            is_same_file(&a, &dir.path().join("a.mp4")),
            "same target via parent join"
        );
        assert!(!is_same_file(&a, &b), "different files");
    }

    #[test]
    fn compute_progress_maps_out_time_to_percentage() {
        // ffmpeg -progress emits microsecond out_time lines
        let p = compute_progress("out_time=00:00:30.000000", 60.0).unwrap();
        assert_eq!(p.progress, 50.0);
        assert_eq!(p.current_time_sec, 30.0);
        assert_eq!(p.total_duration_sec, 60.0);
    }

    #[test]
    fn compute_progress_clamps_overrun_and_skips_junk() {
        // Encoder overrun clamps at 100 instead of reporting >100%
        let p = compute_progress("out_time=00:01:30.000000", 60.0).unwrap();
        assert_eq!(p.progress, 100.0);
        // Unknown total -> no progress reporting
        assert!(compute_progress("out_time=00:00:30.000000", 0.0).is_none());
        // Non-progress lines are ignored
        assert!(compute_progress("frame=   42 fps=30", 60.0).is_none());
    }

    #[test]
    fn progress_payload_serializes_camel_case() {
        let json = serde_json::to_value(ResolutionProgressPayload {
            progress: 42.5,
            current_time_sec: 25.5,
            total_duration_sec: 60.0,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"progress": 42.5, "currentTimeSec": 25.5, "totalDurationSec": 60.0})
        );
    }
}
