//! Local MP4 Trimming
//!
//! Provides trimming of local MP4 files using ffmpeg in one of two modes:
//!
//! - **Copy** (`-c copy`): lossless, fast (seconds), but cut points snap to
//!   the nearest keyframe so effective start/end may drift by a few seconds.
//! - **Reencode** (`libx264`/`aac`): frame-accurate, but slower and lossy
//!   due to recompression.
//!
//! This module is independent of the Bilibili download pipeline: it operates
//! only on local files specified by absolute paths.

use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Event name for trim progress updates emitted to the frontend.
const TRIM_PROGRESS_EVENT: &str = "trim://progress";

/// Trim mode selection.
///
/// `Copy` is the default for speed and losslessness; `Reencode` trades both
/// for frame-accurate cut points.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrimMode {
    /// Stream copy (`-c copy`). Fast and lossless, but snaps to keyframes.
    #[default]
    Copy,
    /// Re-encode with `libx264`/`aac`. Frame-accurate but slower and lossy.
    Reencode,
}

/// Options for a trim operation.
///
/// `start_time` / `end_time` are specified in seconds. Either may be `None`
/// to mean "from the beginning" / "to the end" respectively, but at least
/// one must be `Some`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimOptions {
    /// Absolute path to the input `.mp4` file.
    pub input_path: String,
    /// Start time in seconds. `None` or `0` means from the beginning.
    #[serde(default)]
    pub start_time: Option<f64>,
    /// End time in seconds. `None` means to the end of the file.
    #[serde(default)]
    pub end_time: Option<f64>,
    /// Absolute path for the output `.mp4` file. Must differ from `input_path`.
    pub output_path: String,
    /// Trim mode. Defaults to `Copy` when omitted by the caller.
    #[serde(default)]
    pub mode: TrimMode,
}

/// Result of a successful trim operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimResult {
    /// Absolute path of the written output file.
    pub output_path: String,
}

/// Progress payload emitted via {@link TRIM_PROGRESS_EVENT} while ffmpeg runs.
///
/// `progress` is 0–100 (clamped). `current_time_sec` is the output position
/// reported by ffmpeg; `total_duration_sec` is the expected trim length used
/// as the denominator. The frontend derives elapsed/remaining from these and
/// its own wall-clock start time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimProgressPayload {
    pub progress: f64,
    pub current_time_sec: f64,
    pub total_duration_sec: f64,
}

/// Builds the ffmpeg argument list for a trim.
///
/// Mode behavior:
/// - `Copy`: input-side seeking (`-ss` before `-i`) skips decoded frames
///   for speed. Combined with `-c copy`, completes in seconds. Cut points
///   snap to the nearest keyframe. Uses `-to` (input-absolute end time).
/// - `Reencode`: output-side seeking (`-ss` after `-i`) decodes from the
///   beginning so the cut is frame-accurate. Uses `-t` (duration =
///   `end - start`) instead of `-to` because output-side `-ss` makes
///   `-to` relative to the output timeline, which would over-trim.
///   Re-encodes with `libx264` (CRF 23) and `aac` (192k).
///
/// `-ss 0` is omitted because it has no effect. In copy mode,
/// `-avoid_negative_ts make_zero` prevents timestamp drift that can break
/// some players.
pub fn build_ffmpeg_args(
    input_path: &str,
    start: Option<f64>,
    end: Option<f64>,
    output_path: &str,
    mode: TrimMode,
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

    if mode == TrimMode::Copy {
        if let Some(s) = start {
            if s > 0.0 {
                args.push("-ss".to_string());
                args.push(format_seconds(s));
            }
        }
    }

    args.push("-i".to_string());
    args.push(input_path.to_string());

    if mode == TrimMode::Reencode {
        if let Some(s) = start {
            if s > 0.0 {
                args.push("-ss".to_string());
                args.push(format_seconds(s));
            }
        }
    }

    // End-time handling differs by mode:
    // - Copy: input-side `-ss` makes `-to` an input-absolute time.
    // - Reencode: output-side `-ss` makes `-to` relative to the OUTPUT
    //   timeline, so we use `-t` (duration = end - start) to avoid
    //   trimming more than intended.
    match mode {
        TrimMode::Copy => {
            if let Some(e) = end {
                args.push("-to".to_string());
                args.push(format_seconds(e));
            }
        }
        TrimMode::Reencode => {
            if let Some(e) = end {
                let s = start.unwrap_or(0.0);
                let duration = (e - s).max(0.0);
                if duration > 0.0 {
                    args.push("-t".to_string());
                    args.push(format_seconds(duration));
                }
            }
        }
    }

    match mode {
        TrimMode::Copy => {
            args.push("-c".to_string());
            args.push("copy".to_string());
            args.push("-avoid_negative_ts".to_string());
            args.push("make_zero".to_string());
        }
        TrimMode::Reencode => {
            args.push("-c:v".to_string());
            args.push("libx264".to_string());
            args.push("-preset".to_string());
            args.push("medium".to_string());
            args.push("-crf".to_string());
            args.push("23".to_string());
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            args.push("-b:a".to_string());
            args.push("192k".to_string());
        }
    }

    args.push("-y".to_string());
    args.push(output_path.to_string());

    args
}

fn format_seconds(secs: f64) -> String {
    format!("{:.3}", secs)
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

/// Computes the expected output duration in seconds from the trim range.
///
/// Returns `None` only when the input was rejected upstream (no range at
/// all); the start-only case is handled by the caller via
/// {@link probe_input_duration_sec} because the total then depends on the
/// input file's duration.
fn compute_total_duration(start: Option<f64>, end: Option<f64>) -> Option<f64> {
    match (start, end) {
        (Some(s), Some(e)) => Some((e - s).max(0.0)),
        (None, Some(e)) => Some(e.max(0.0)),
        _ => None,
    }
}

/// Parses an `out_time=HH:MM:SS.fraction` line from ffmpeg's `-progress`
/// output into seconds. Returns `None` for unrelated lines or malformed
/// timestamps.
fn parse_out_time(line: &str) -> Option<f64> {
    let s = line.strip_prefix("out_time=")?.trim();
    parse_hhmmss(s)
}

/// Parses an `HH:MM:SS.fraction` timestamp into seconds.
fn parse_hhmmss(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// Probes the duration of `input_path` in seconds by running `ffmpeg -i`
/// and parsing the `Duration: HH:MM:SS.xx` line from stderr.
///
/// Used when only a start time is supplied so we can still compute a
/// progress percentage. Returns `None` on any parse failure — the caller
/// falls back to no progress events.
async fn probe_input_duration_sec(ffmpeg_path: &Path, input_path: &str) -> Option<f64> {
    let mut cmd = AsyncCommand::new(ffmpeg_path);
    cmd.arg("-i").arg(input_path);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().await.ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        if let Some(idx) = line.find("Duration:") {
            let rest = &line[idx + "Duration:".len()..];
            let token = rest.trim().split([',', ' ']).next()?;
            return parse_hhmmss(token);
        }
    }
    None
}

/// Validates inputs and runs ffmpeg to produce the trimmed output.
///
/// # Errors
///
/// Returns strings beginning with `ERR::TRIM_*` so the frontend can map
/// them via the shared error map:
/// - `ERR::TRIM_INPUT_NOT_FOUND`
/// - `ERR::TRIM_UNSUPPORTED_FORMAT` (input not `.mp4`)
/// - `ERR::TRIM_UNSUPPORTED_OUTPUT_FORMAT` (output not `.mp4`)
/// - `ERR::TRIM_SAME_PATH`
/// - `ERR::TRIM_INVALID_RANGE`
/// - `ERR::TRIM_NO_RANGE` (both start and end are `None`)
/// - `ERR::TRIM_FFMPEG_FAILED`
pub async fn trim_video(app: &AppHandle, options: &TrimOptions) -> Result<TrimResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::TRIM_INPUT_NOT_FOUND".to_string());
    }
    if !is_mp4(input_path) {
        return Err("ERR::TRIM_UNSUPPORTED_FORMAT".to_string());
    }
    if !is_mp4(output_path) {
        return Err("ERR::TRIM_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    if is_same_file(input_path, output_path) {
        return Err("ERR::TRIM_SAME_PATH".to_string());
    }
    if options.start_time.is_none() && options.end_time.is_none() {
        return Err("ERR::TRIM_NO_RANGE".to_string());
    }
    if let Some(s) = options.start_time {
        if s < 0.0 {
            return Err("ERR::TRIM_INVALID_RANGE".to_string());
        }
    }
    if let Some(e) = options.end_time {
        if e < 0.0 {
            return Err("ERR::TRIM_INVALID_RANGE".to_string());
        }
    }
    if let (Some(s), Some(e)) = (options.start_time, options.end_time) {
        if s >= e {
            return Err("ERR::TRIM_INVALID_RANGE".to_string());
        }
    }

    let ffmpeg_path = get_ffmpeg_path(app);
    let input_str = options.input_path.clone();
    let output_str = options.output_path.clone();
    let args = build_ffmpeg_args(
        &input_str,
        options.start_time,
        options.end_time,
        &output_str,
        options.mode,
    );

    let total_duration_sec = match compute_total_duration(options.start_time, options.end_time) {
        Some(d) => Some(d),
        None => {
            // start-only case: probe input duration, then subtract start
            // so the bar reflects the actual trim length.
            if let Some(start) = options.start_time {
                probe_input_duration_sec(&ffmpeg_path, &input_str)
                    .await
                    .map(|d| (d - start).max(0.0))
            } else {
                None
            }
        }
    };

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
        .map_err(|e| format!("ERR::TRIM_FFMPEG_FAILED: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::TRIM_FFMPEG_FAILED: no stderr".to_string())?;

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
                            TRIM_PROGRESS_EVENT,
                            TrimProgressPayload {
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
        .map_err(|e| format!("ERR::TRIM_FFMPEG_FAILED: wait {e}"))?;

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ERR::TRIM_FFMPEG_FAILED\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(TrimResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_copy_with_both_times_puts_ss_before_input() {
        let args = build_ffmpeg_args(
            "input.mp4",
            Some(60.0),
            Some(180.0),
            "out.mp4",
            TrimMode::Copy,
        );
        let ss_pos = args.iter().position(|a| a == "-ss").unwrap();
        let i_pos = args.iter().position(|a| a == "-i").unwrap();
        assert!(ss_pos < i_pos);
        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&"-to".to_string()));
        assert!(args.contains(&"60.000".to_string()));
        assert!(args.contains(&"180.000".to_string()));
        assert!(args.contains(&"-avoid_negative_ts".to_string()));
        assert!(args.contains(&"make_zero".to_string()));
        assert!(args.last().is_some_and(|a| a == "out.mp4"));
    }

    #[test]
    fn build_args_copy_with_start_only_omits_to() {
        let args = build_ffmpeg_args("input.mp4", Some(30.0), None, "out.mp4", TrimMode::Copy);
        assert!(args.iter().any(|a| a == "-ss"));
        assert!(!args.iter().any(|a| a == "-to"));
    }

    #[test]
    fn build_args_copy_with_end_only_omits_ss() {
        let args = build_ffmpeg_args("input.mp4", None, Some(120.0), "out.mp4", TrimMode::Copy);
        assert!(!args.iter().any(|a| a == "-ss"));
        assert!(args.iter().any(|a| a == "-to"));
    }

    #[test]
    fn build_args_copy_with_zero_start_omits_ss() {
        let args = build_ffmpeg_args(
            "input.mp4",
            Some(0.0),
            Some(60.0),
            "out.mp4",
            TrimMode::Copy,
        );
        assert!(!args.iter().any(|a| a == "-ss"));
        assert!(args.iter().any(|a| a == "-to"));
    }

    #[test]
    fn build_args_reencode_puts_ss_after_input() {
        let args = build_ffmpeg_args(
            "input.mp4",
            Some(60.0),
            Some(180.0),
            "out.mp4",
            TrimMode::Reencode,
        );
        let ss_pos = args.iter().position(|a| a == "-ss").unwrap();
        let i_pos = args.iter().position(|a| a == "-i").unwrap();
        assert!(ss_pos > i_pos);
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"-preset".to_string()));
        assert!(args.contains(&"medium".to_string()));
        assert!(args.contains(&"-crf".to_string()));
        assert!(args.contains(&"23".to_string()));
        assert!(args.contains(&"-c:a".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"192k".to_string()));
        // Copy-only flags must not appear in reencode mode.
        assert!(!args.contains(&"-avoid_negative_ts".to_string()));
    }

    #[test]
    fn build_args_reencode_uses_t_not_to() {
        let args = build_ffmpeg_args(
            "input.mp4",
            Some(60.0),
            Some(180.0),
            "out.mp4",
            TrimMode::Reencode,
        );
        // Reencode must use -t (duration) not -to (absolute end), because
        // output-side -ss makes -to relative to the output timeline.
        assert!(args.contains(&"-t".to_string()));
        assert!(!args.contains(&"-to".to_string()));
        assert!(args.contains(&"120.000".to_string()));
    }

    #[test]
    fn build_args_copy_uses_to_not_t() {
        let args = build_ffmpeg_args(
            "input.mp4",
            Some(60.0),
            Some(180.0),
            "out.mp4",
            TrimMode::Copy,
        );
        assert!(args.contains(&"-to".to_string()));
        assert!(!args.contains(&"-t".to_string()));
        assert!(args.contains(&"180.000".to_string()));
    }

    #[test]
    fn build_args_reencode_omits_copy_flag() {
        let args = build_ffmpeg_args("input.mp4", Some(30.0), None, "out.mp4", TrimMode::Reencode);
        assert!(!args.iter().any(|a| a == "copy"));
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
            Some(10.0),
            Some(20.0),
            "out.mp4",
            TrimMode::Copy,
        );
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.contains(&"-stats_period".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:2".to_string()));
    }

    #[test]
    fn compute_total_duration_both_times() {
        assert_eq!(compute_total_duration(Some(60.0), Some(180.0)), Some(120.0));
    }

    #[test]
    fn compute_total_duration_end_only() {
        assert_eq!(compute_total_duration(None, Some(90.0)), Some(90.0));
    }

    #[test]
    fn compute_total_duration_start_only_is_none() {
        assert_eq!(compute_total_duration(Some(30.0), None), None);
    }

    #[test]
    fn compute_total_duration_clamps_negative() {
        assert_eq!(compute_total_duration(Some(100.0), Some(50.0)), Some(0.0));
    }

    #[test]
    fn parse_out_time_seconds() {
        assert_eq!(parse_out_time("out_time=00:00:12.500000\n"), Some(12.5));
    }

    #[test]
    fn parse_out_time_with_hours() {
        assert_eq!(parse_out_time("out_time=01:02:03.000000\n"), Some(3723.0));
    }

    #[test]
    fn parse_out_time_ignores_other_keys() {
        assert_eq!(parse_out_time("frame=123\n"), None);
        assert_eq!(parse_out_time("out_time_ms=12345678\n"), None);
    }

    #[test]
    fn parse_hhmmss_with_fraction() {
        assert_eq!(parse_hhmmss("00:01:23.450000"), Some(83.45));
    }

    #[test]
    fn parse_hhmmss_rejects_short_input() {
        assert_eq!(parse_hhmmss("01:23"), None);
        assert_eq!(parse_hhmmss("not a time"), None);
    }
}
