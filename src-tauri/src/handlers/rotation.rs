//! Local MP4 Rotation
//!
//! Provides rotation of local MP4 files using ffmpeg in one of two modes:
//!
//! - **Copy** (metadata-only): lossless, fast (seconds), but some players may
//!   ignore the display matrix flag. Uses `-display_rotation` (FFmpeg 6.0+)
//!   with `-c copy`, writing the rotation into the output's display matrix
//!   without re-encoding.
//! - **Reencode** (`transpose` filter): rotates the actual pixels so every
//!   player shows the rotation. Slower and lossy due to recompression.
//!
//! This module is independent of the Bilibili download pipeline: it operates
//! only on local files specified by absolute paths.

use crate::utils::ffmpeg_probe::probe_duration_sec;
use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Event name for rotation progress updates emitted to the frontend.
const ROTATION_PROGRESS_EVENT: &str = "rotation://progress";

/// Internal rotation angle, expressed as clockwise degrees.
///
/// `Clockwise90`/`Clockwise270` map to the UI labels "Right 90°"/"Left 90°"
/// (clockwise 270° == counter-clockwise 90°). This is an internal
/// representation only — the wire DTO (`RotationOptions.angle`) is a raw
/// `u16` because the frontend sends a JSON number, and serde cannot
/// deserialize a number into an externally-tagged enum variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotationAngle {
    Clockwise90,
    Clockwise180,
    Clockwise270,
}

impl RotationAngle {
    /// Counter-clockwise degrees for FFmpeg's `-display_rotation` (copy mode).
    ///
    /// CONSTRAINT: `-display_rotation` (FFmpeg 6.0+) is an input, per-stream
    /// option that takes counter-clockwise degrees. Clockwise rotation
    /// therefore maps to `(360 - cw) % 360`:
    /// CW90 -> CCW270, CW180 -> CCW180, CW270 -> CCW90.
    fn display_rotation_ccw_degrees(&self) -> u32 {
        match self {
            Self::Clockwise90 => 270,
            Self::Clockwise180 => 180,
            Self::Clockwise270 => 90,
        }
    }

    /// `transpose` filter chain for reencode mode.
    ///
    /// `transpose` is a 90°-only filter, so 180° is two `clock` applications
    /// chained. Symbolic constants (`clock`/`cclock`) are used instead of the
    /// deprecated numeric values per the ffmpeg-filters documentation.
    fn transpose_filter(&self) -> &'static str {
        match self {
            Self::Clockwise90 => "transpose=clock",
            Self::Clockwise180 => "transpose=clock,transpose=clock",
            Self::Clockwise270 => "transpose=cclock",
        }
    }
}

/// Rotation mode selection.
///
/// `Copy` is the default for speed and losslessness; `Reencode` trades both
/// for guaranteed player compatibility.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RotationMode {
    /// Metadata-only rotation (`-display_rotation` + `-c copy`). Fast and
    /// lossless, but player-dependent.
    #[default]
    Copy,
    /// Re-encode with `transpose` filter. Frame-accurate but slower and lossy.
    Reencode,
}

/// Options for a rotation operation.
///
/// `angle` is a clockwise degrees integer (90/180/270) sent as a JSON number
/// by the frontend; it is validated and converted to {@link RotationAngle}
/// inside `rotate_video`. `mode` selects whether to write only the display
/// matrix or re-encode the pixels.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationOptions {
    /// Absolute path to the input `.mp4` file.
    pub input_path: String,
    /// Absolute path for the output `.mp4` file. Must differ from `input_path`.
    pub output_path: String,
    /// Rotation angle in clockwise degrees (90, 180, or 270).
    pub angle: u16,
    /// Rotation mode. Defaults to `Copy` when omitted by the caller.
    #[serde(default)]
    pub mode: RotationMode,
}

/// Result of a successful rotation operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationResult {
    /// Absolute path of the written output file.
    pub output_path: String,
}

/// Progress payload emitted via {@link ROTATION_PROGRESS_EVENT} while ffmpeg runs.
///
/// `progress` is 0–100 (clamped). `current_time_sec` is the output position
/// reported by ffmpeg; `total_duration_sec` is the input duration used
/// as the denominator. The frontend derives elapsed/remaining from these and
/// its own wall-clock start time.
///
/// CAUTION: In copy mode ffmpeg finishes near-instantly, so progress events
/// are effectively unused; the frontend shows a spinner instead of a bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationProgressPayload {
    pub progress: f64,
    pub current_time_sec: f64,
    pub total_duration_sec: f64,
}

/// Builds the ffmpeg argument list for a rotation.
///
/// Mode behavior:
/// - `Copy`: writes the display matrix only via `-display_rotation` (an
///   input, per-stream option, so it precedes `-i`) plus `-c copy`. `-map 0`
///   keeps every input stream (audio, subtitles) in the output.
/// - `Reencode`: applies the `transpose` filter and re-encodes video with
///   `libx264` (CRF 23, preset medium). Audio is copied since rotation does
///   not affect it.
pub fn build_ffmpeg_args(
    input_path: &str,
    angle: RotationAngle,
    output_path: &str,
    mode: RotationMode,
) -> Vec<String> {
    // Suppress default stats and emit structured `key=value` progress to
    // stderr so we can parse `out_time=` for the progress bar. Emit at
    // 1-second cadence; the frontend's CSS transition (1s ease-linear)
    // interpolates between updates so the bar moves continuously instead
    // of jumping per emit.
    let mut args: Vec<String> = vec![
        "-nostats".to_string(),
        "-stats_period".to_string(),
        "1".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
    ];

    match mode {
        RotationMode::Copy => {
            // `-display_rotation` (FFmpeg 6.0+) is an input, per-stream option,
            // so it MUST precede `-i`. With `-c copy` the rotation is written
            // into the output's display matrix without re-encoding.
            args.push("-display_rotation:v:0".to_string());
            args.push(angle.display_rotation_ccw_degrees().to_string());
            args.push("-i".to_string());
            args.push(input_path.to_string());
            // `-map 0` keeps every input stream (audio, subtitles) in the copy
            // so they are not dropped by ffmpeg's default stream selection.
            args.push("-map".to_string());
            args.push("0".to_string());
            args.push("-c".to_string());
            args.push("copy".to_string());
        }
        RotationMode::Reencode => {
            args.push("-i".to_string());
            args.push(input_path.to_string());
            args.push("-vf".to_string());
            args.push(angle.transpose_filter().to_string());
            args.push("-c:v".to_string());
            args.push("libx264".to_string());
            args.push("-preset".to_string());
            args.push("medium".to_string());
            args.push("-crf".to_string());
            args.push("23".to_string());
            // Rotation touches video only; copy audio to avoid needless
            // recompression and quality loss.
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
    }

    args.push("-y".to_string());
    args.push(output_path.to_string());

    args
}

fn is_mp4(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
}

/// Checks whether two paths refer to the same file on disk.
///
/// Canonicalizes both paths to catch same-file references via symlinks,
/// relative paths, `.`/`..` segments, or case differences (Windows). The
/// input must exist; the output may not yet, so its parent is canonicalized
/// and the file name rejoined. Falls back to lexical comparison if
/// canonicalization fails entirely.
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

/// Validates the numeric angle and converts it to {@link RotationAngle}.
///
/// Returns `Err("ERR::ROTATION_INVALID_ANGLE")` for any value other than
/// 90/180/270.
fn resolve_angle(angle: u16) -> Result<RotationAngle, String> {
    match angle {
        90 => Ok(RotationAngle::Clockwise90),
        180 => Ok(RotationAngle::Clockwise180),
        270 => Ok(RotationAngle::Clockwise270),
        _ => Err("ERR::ROTATION_INVALID_ANGLE".to_string()),
    }
}

/// Validates inputs and runs ffmpeg to produce the rotated output.
///
/// # Errors
///
/// Returns strings beginning with `ERR::ROTATION_*` so the frontend can map
/// them via the shared error map:
/// - `ERR::ROTATION_INPUT_NOT_FOUND`
/// - `ERR::ROTATION_UNSUPPORTED_FORMAT` (input not `.mp4`)
/// - `ERR::ROTATION_UNSUPPORTED_OUTPUT_FORMAT` (output not `.mp4`)
/// - `ERR::ROTATION_SAME_PATH`
/// - `ERR::ROTATION_INVALID_ANGLE` (angle not 90/180/270)
/// - `ERR::ROTATION_FFMPEG_FAILED`
pub async fn rotate_video(
    app: &AppHandle,
    options: &RotationOptions,
) -> Result<RotationResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::ROTATION_INPUT_NOT_FOUND".to_string());
    }
    if !is_mp4(input_path) {
        return Err("ERR::ROTATION_UNSUPPORTED_FORMAT".to_string());
    }
    if !is_mp4(output_path) {
        return Err("ERR::ROTATION_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    if is_same_file(input_path, output_path) {
        return Err("ERR::ROTATION_SAME_PATH".to_string());
    }
    let angle = resolve_angle(options.angle)?;

    let ffmpeg_path = get_ffmpeg_path(app);
    let input_str = options.input_path.clone();
    let output_str = options.output_path.clone();
    let args = build_ffmpeg_args(&input_str, angle, &output_str, options.mode);

    // Probe input duration for progress tracking. In copy mode this is unused
    // (ffmpeg finishes near-instantly), but probing is cheap and keeps the
    // progress loop below uniform with the other tool handlers.
    let total_duration_sec = probe_duration_sec(&ffmpeg_path, &input_str).await;

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
        .map_err(|e| format!("ERR::ROTATION_FFMPEG_FAILED: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::ROTATION_FFMPEG_FAILED: no stderr".to_string())?;

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
                            ROTATION_PROGRESS_EVENT,
                            RotationProgressPayload {
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
        .map_err(|e| format!("ERR::ROTATION_FFMPEG_FAILED: wait {e}"))?;

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ERR::ROTATION_FFMPEG_FAILED\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(RotationResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_rotation_ccw_degrees_maps_clockwise_to_counter_clockwise() {
        assert_eq!(
            RotationAngle::Clockwise90.display_rotation_ccw_degrees(),
            270
        );
        assert_eq!(
            RotationAngle::Clockwise180.display_rotation_ccw_degrees(),
            180
        );
        assert_eq!(
            RotationAngle::Clockwise270.display_rotation_ccw_degrees(),
            90
        );
    }

    #[test]
    fn transpose_filter_uses_symbolic_constants() {
        assert_eq!(
            RotationAngle::Clockwise90.transpose_filter(),
            "transpose=clock"
        );
        assert_eq!(
            RotationAngle::Clockwise180.transpose_filter(),
            "transpose=clock,transpose=clock"
        );
        assert_eq!(
            RotationAngle::Clockwise270.transpose_filter(),
            "transpose=cclock"
        );
    }

    #[test]
    fn resolve_angle_accepts_valid_values() {
        assert_eq!(resolve_angle(90).unwrap(), RotationAngle::Clockwise90);
        assert_eq!(resolve_angle(180).unwrap(), RotationAngle::Clockwise180);
        assert_eq!(resolve_angle(270).unwrap(), RotationAngle::Clockwise270);
    }

    #[test]
    fn resolve_angle_rejects_invalid_values() {
        assert!(resolve_angle(0).is_err());
        assert!(resolve_angle(45).is_err());
        assert!(resolve_angle(360).is_err());
    }

    #[test]
    fn deserialize_options_accepts_numeric_angle_copy() {
        // The frontend sends `angle` as a JSON number. Regression guard for
        // the externally-tagged-enum pitfall (serde rejects numbers for enum
        // variants), so the DTO must use a raw integer.
        let json = r#"{"inputPath":"a.mp4","outputPath":"b.mp4","angle":90,"mode":"copy"}"#;
        let opts: RotationOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.angle, 90);
        assert_eq!(opts.mode, RotationMode::Copy);
    }

    #[test]
    fn deserialize_options_accepts_numeric_angle_reencode() {
        let json = r#"{"inputPath":"a.mp4","outputPath":"b.mp4","angle":270,"mode":"reencode"}"#;
        let opts: RotationOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.angle, 270);
        assert_eq!(opts.mode, RotationMode::Reencode);
    }

    #[test]
    fn deserialize_options_defaults_mode_to_copy_when_omitted() {
        let json = r#"{"inputPath":"a.mp4","outputPath":"b.mp4","angle":180}"#;
        let opts: RotationOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.angle, 180);
        assert_eq!(opts.mode, RotationMode::Copy);
    }

    #[test]
    fn build_args_copy_mode_right90() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise90,
            "out.mp4",
            RotationMode::Copy,
        );
        // -display_rotation is an input option and must precede -i.
        let display_pos = args
            .iter()
            .position(|a| a == "-display_rotation:v:0")
            .unwrap();
        let i_pos = args.iter().position(|a| a == "-i").unwrap();
        assert!(display_pos < i_pos);
        // CW90 maps to CCW270 for -display_rotation.
        assert!(args.contains(&"270".to_string()));
        // -map 0 keeps every stream in the copy.
        assert!(args.iter().any(|a| a == "-map"));
        assert!(args.iter().any(|a| a == "0"));
        assert!(args.iter().any(|a| a == "-c"));
        assert!(args.iter().any(|a| a == "copy"));
        // Reencode flags must not appear in copy mode.
        assert!(!args.iter().any(|a| a == "-vf"));
        assert!(!args.iter().any(|a| a.contains("transpose")));
    }

    #[test]
    fn build_args_copy_mode_180() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise180,
            "out.mp4",
            RotationMode::Copy,
        );
        assert!(args.contains(&"180".to_string()));
    }

    #[test]
    fn build_args_copy_mode_left90() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise270,
            "out.mp4",
            RotationMode::Copy,
        );
        // CW270 maps to CCW90 for -display_rotation.
        assert!(args.contains(&"90".to_string()));
    }

    #[test]
    fn build_args_reencode_mode_right90() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise90,
            "out.mp4",
            RotationMode::Reencode,
        );
        assert!(args.iter().any(|a| a == "-vf"));
        assert!(args.iter().any(|a| a == "transpose=clock"));
        assert!(args.iter().any(|a| a == "-c:v"));
        assert!(args.iter().any(|a| a == "libx264"));
        assert!(args.iter().any(|a| a == "-preset"));
        assert!(args.iter().any(|a| a == "medium"));
        assert!(args.iter().any(|a| a == "-crf"));
        assert!(args.iter().any(|a| a == "23"));
        // Audio is copied, not re-encoded.
        assert!(args.iter().any(|a| a == "-c:a"));
        assert!(args.iter().any(|a| a == "copy"));
        // Copy-only flags must not appear in reencode mode.
        assert!(!args.iter().any(|a| a == "-display_rotation:v:0"));
        assert!(!args.iter().any(|a| a == "-map"));
    }

    #[test]
    fn build_args_reencode_mode_180() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise180,
            "out.mp4",
            RotationMode::Reencode,
        );
        // 180° is two clock applications chained.
        assert!(args.iter().any(|a| a == "transpose=clock,transpose=clock"));
    }

    #[test]
    fn build_args_reencode_mode_left90() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise270,
            "out.mp4",
            RotationMode::Reencode,
        );
        assert!(args.iter().any(|a| a == "transpose=cclock"));
    }

    #[test]
    fn is_mp4_checks_extension_case_insensitively() {
        assert!(is_mp4(Path::new("video.mp4")));
        assert!(is_mp4(Path::new("VIDEO.MP4")));
        assert!(!is_mp4(Path::new("video.mkv")));
        assert!(!is_mp4(Path::new("video")));
        assert!(!is_mp4(Path::new("video.mp4.bak")));
    }

    #[test]
    fn build_args_always_includes_progress_flags() {
        let args = build_ffmpeg_args(
            "input.mp4",
            RotationAngle::Clockwise90,
            "out.mp4",
            RotationMode::Copy,
        );
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.contains(&"-stats_period".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:2".to_string()));
    }
}
