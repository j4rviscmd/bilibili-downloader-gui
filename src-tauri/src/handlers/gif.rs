//! Local MP4 to GIF/WebM Animation Generation
//!
//! Cuts a time range out of a local MP4 and re-encodes it as an animated
//! GIF or a silent WebM using ffmpeg:
//!
//! - **GIF**: encoded with ffmpeg's built-in color quantization
//!   (`-vf fps/scale` + the GIF encoder; see the CAUTION note in
//!   [`build_ffmpeg_args`] for why palettegen is not used). `-loop 0`
//!   makes the animation loop forever.
//! - **WebM**: VP9 with CRF-based quality (`-b:v 0`), always silent
//!   (`-an`) — the shared use case is short highlight clips for
//!   messaging/SNS, not audio-visual playback.
//!
//! This module is independent of the Bilibili download pipeline: it operates
//! only on local files specified by absolute paths.

use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Event name for GIF/WebM generation progress updates emitted to the frontend.
const GIF_PROGRESS_EVENT: &str = "gif://progress";

/// Output format selection.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GifFormat {
    /// Animated GIF (256-color, built-in quantization).
    #[default]
    Gif,
    /// Silent WebM (VP9).
    Webm,
}

impl GifFormat {
    /// Expected output file extension for the format.
    fn extension(&self) -> &'static str {
        match self {
            GifFormat::Gif => "gif",
            GifFormat::Webm => "webm",
        }
    }
}

/// Options for a GIF/WebM generation operation.
///
/// `start_time` / `end_time` are required and specified in seconds
/// (`start_time < end_time`). `width` rescales the clip with the aspect
/// ratio preserved; `None` keeps the original width.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifOptions {
    /// Absolute path to the input `.mp4` file.
    pub input_path: String,
    /// Start time in seconds. Must be >= 0.
    pub start_time: f64,
    /// End time in seconds. Must be > `start_time`.
    pub end_time: f64,
    /// Absolute path for the output `.gif` / `.webm` file. Must differ from
    /// `input_path` and match {@link GifFormat::extension}.
    pub output_path: String,
    /// Output format. Defaults to `Gif` when omitted by the caller.
    #[serde(default)]
    pub format: GifFormat,
    /// Target width in pixels (height auto-computed, aspect preserved).
    /// `None` keeps the original width.
    #[serde(default)]
    pub width: Option<u32>,
    /// Output frame rate. Frontend presets: 10 / 15 / 24.
    pub fps: u32,
}

/// Result of a successful generation operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifResult {
    /// Absolute path of the written output file.
    pub output_path: String,
}

/// Progress payload emitted via {@link GIF_PROGRESS_EVENT} while ffmpeg runs.
///
/// Same shape as the other tool progress events: `progress` is 0–100
/// (clamped), `current_time_sec` is the output position reported by ffmpeg,
/// `total_duration_sec` is the clip length (`end - start`) used as the
/// denominator.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifProgressPayload {
    pub progress: f64,
    pub current_time_sec: f64,
    pub total_duration_sec: f64,
}

/// Builds the fps + scale filter chain shared by both formats.
///
/// fps always applies (animation output is resampled from the source frame
/// rate); scale only applies when a target width is given. `scale=W:-2`
/// rounds the height to an even value, which VP9's yuv420p requires.
fn build_filter_chain(width: Option<u32>, fps: u32) -> String {
    let mut chain = format!("fps={fps}");
    if let Some(w) = width {
        chain.push_str(&format!(",scale={w}:-2:flags=lanczos"));
    }
    chain
}

/// Builds the ffmpeg argument list for a GIF/WebM generation.
///
/// Input-side seeking (`-ss` before `-i`) is fast and, because this path
/// always transcodes, frame-accurate enough for highlight clips. The clip
/// length is expressed as `-t` (duration), which is immune to the timestamp
/// reset that input-side seeking causes (see `handlers::trim` for the same
/// reasoning).
pub fn build_ffmpeg_args(options: &GifOptions) -> Vec<String> {
    // Suppress default stats and emit structured `key=value` progress to
    // stderr so we can parse `out_time=` for the progress bar. Emit at
    // 1-second cadence; the frontend's CSS transition (1s ease-linear)
    // interpolates between updates so the bar moves continuously instead
    // of jumping per emit.
    //
    // Rotation: ffmpeg's default autorotate stays ON. Streams with a
    // display-matrix rotation (portrait captures) get the rotation burned
    // into the output pixels — GIF/WebM carry no rotation metadata, and
    // burning it in matches what QuickLook/standard players display.
    let mut args: Vec<String> = ["-nostats", "-stats_period", "1", "-progress", "pipe:2"]
        .into_iter()
        .map(String::from)
        .collect();

    if options.start_time > 0.0 {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", options.start_time));
    }

    args.push("-i".to_string());
    args.push(options.input_path.clone());

    args.push("-t".to_string());
    args.push(format!("{:.3}", options.end_time - options.start_time));

    // CAUTION: GIF uses ffmpeg's built-in palette quantization (no
    // palettegen/paletteuse). The palettegen filter hangs after EOF on the
    // evermeet ffmpeg 8.1.1 build shipped for macOS (process never exits,
    // output already flushed) — reproducible even with `-frames:v 1`.
    // Revisit the higher-quality palette pipeline once the bundled ffmpeg
    // is confirmed fixed on all three platforms.
    args.push("-vf".to_string());
    args.push(build_filter_chain(options.width, options.fps));
    match options.format {
        GifFormat::Gif => {
            // `-loop 0` makes the GIF loop forever.
            args.push("-loop".to_string());
            args.push("0".to_string());
        }
        GifFormat::Webm => {
            // `-b:v 0` switches VP9 to pure CRF-driven quality; `-row-mt`
            // speeds up encoding on multi-core CPUs. Always silent: the
            // feature targets short shareable animation clips.
            args.extend(
                [
                    "-c:v",
                    "libvpx-vp9",
                    "-crf",
                    "35",
                    "-b:v",
                    "0",
                    "-row-mt",
                    "1",
                    "-an",
                ]
                .into_iter()
                .map(String::from),
            );
        }
    }

    args.push("-y".to_string());
    args.push(options.output_path.clone());

    args
}

fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
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

/// Validates inputs and runs ffmpeg to produce the animation output.
///
/// # Errors
///
/// Returns strings beginning with `ERR::GIF_*` so the frontend can map
/// them via the shared error map:
/// - `ERR::GIF_INPUT_NOT_FOUND`
/// - `ERR::GIF_UNSUPPORTED_FORMAT` (input not `.mp4`)
/// - `ERR::GIF_UNSUPPORTED_OUTPUT_FORMAT` (extension does not match format)
/// - `ERR::GIF_SAME_PATH`
/// - `ERR::GIF_INVALID_RANGE` (`start >= end` or negative start)
/// - `ERR::GIF_FFMPEG_FAILED`
pub async fn generate_animation(
    app: &AppHandle,
    options: &GifOptions,
) -> Result<GifResult, String> {
    generate_animation_with_ffmpeg(&get_ffmpeg_path(app), app, options).await
}

/// Path-injected split of [`generate_animation`] (test seam, issue #646):
/// runs the same validation→args→spawn→progress flow against an explicit
/// ffmpeg binary so tests drive it with a fake script in a tempdir.
// Why: generic over R, not the default-Wry `&AppHandle`, because the E2E tests
// below pass `tauri::test::mock_app().handle()` (`AppHandle<MockRuntime>`,
// tauri "test" feature in src-tauri/Cargo.toml), which only type-checks
// against a generic Runtime param (issue #646).
pub(crate) async fn generate_animation_with_ffmpeg<R: tauri::Runtime>(
    ffmpeg_path: &Path,
    app: &tauri::AppHandle<R>,
    options: &GifOptions,
) -> Result<GifResult, String> {
    let input_path = Path::new(&options.input_path);
    let output_path = Path::new(&options.output_path);

    if !input_path.exists() {
        return Err("ERR::GIF_INPUT_NOT_FOUND".to_string());
    }
    if !has_extension(input_path, "mp4") {
        return Err("ERR::GIF_UNSUPPORTED_FORMAT".to_string());
    }
    if !has_extension(output_path, options.format.extension()) {
        return Err("ERR::GIF_UNSUPPORTED_OUTPUT_FORMAT".to_string());
    }
    if is_same_file(input_path, output_path) {
        return Err("ERR::GIF_SAME_PATH".to_string());
    }
    if options.start_time < 0.0 || options.start_time >= options.end_time {
        return Err("ERR::GIF_INVALID_RANGE".to_string());
    }

    let args = build_ffmpeg_args(options);
    let total_duration_sec = options.end_time - options.start_time;

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
        .map_err(|e| format!("ERR::GIF_FFMPEG_FAILED: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::GIF_FFMPEG_FAILED: no stderr".to_string())?;

    let mut stderr_reader = BufReader::new(stderr);
    let app_for_progress = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut stderr_lines = String::new();
        let mut line = String::new();
        while stderr_reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            stderr_lines.push_str(&line);

            if total_duration_sec > 0.0 {
                if let Some(current) = parse_out_time(&line) {
                    let progress = (current / total_duration_sec * 100.0).clamp(0.0, 100.0);
                    let _ = app_for_progress.emit(
                        GIF_PROGRESS_EVENT,
                        GifProgressPayload {
                            progress,
                            current_time_sec: current,
                            total_duration_sec,
                        },
                    );
                }
            }

            line.clear();
        }
        stderr_lines
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ERR::GIF_FFMPEG_FAILED: wait {e}"))?;

    let stderr_output = stderr_task.await.unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ERR::GIF_FFMPEG_FAILED\nExit code: {:?}\nstderr: {}",
            status.code(),
            stderr_output
        ));
    }

    Ok(GifResult {
        output_path: options.output_path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gif_options(format: GifFormat, output: &str) -> GifOptions {
        GifOptions {
            input_path: "input.mp4".to_string(),
            start_time: 10.0,
            end_time: 40.0,
            output_path: output.to_string(),
            format,
            width: Some(480),
            fps: 15,
        }
    }

    #[test]
    fn build_args_gif_uses_simple_filter_and_loop() {
        let args = build_ffmpeg_args(&gif_options(GifFormat::Gif, "out.gif"));
        let vf_pos = args.iter().position(|a| a == "-vf").unwrap();
        assert_eq!(args[vf_pos + 1], "fps=15,scale=480:-2:flags=lanczos");
        assert!(args.contains(&"-loop".to_string()));
        let loop_pos = args.iter().position(|a| a == "-loop").unwrap();
        assert_eq!(args[loop_pos + 1], "0");
        // GIF relies on the encoder's built-in quantization: no palettegen
        // (hangs after EOF on the bundled ffmpeg 8.1.1 macOS build) and no
        // codec flags.
        assert!(!args.iter().any(|a| a == "-filter_complex"));
        assert!(!args.contains(&"-an".to_string()));
        assert!(!args.contains(&"-c:v".to_string()));
        assert!(args.last().is_some_and(|a| a == "out.gif"));
    }

    #[test]
    fn build_args_webm_uses_vp9_and_silence() {
        let args = build_ffmpeg_args(&gif_options(GifFormat::Webm, "out.webm"));
        let vf = args
            .windows(2)
            .find(|w| w[0] == "-vf")
            .map(|w| w[1].as_str())
            .unwrap();
        assert_eq!(vf, "fps=15,scale=480:-2:flags=lanczos");
        for flag in [
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "35",
            "-b:v",
            "0",
            "-row-mt",
            "-an",
        ] {
            assert!(args.contains(&flag.to_string()), "missing {flag}");
        }
        // No GIF palette flags in WebM mode.
        assert!(!args.contains(&"-loop".to_string()));
        assert!(args.last().is_some_and(|a| a == "out.webm"));
    }

    #[test]
    fn build_args_original_width_omits_scale() {
        let mut options = gif_options(GifFormat::Gif, "out.gif");
        options.width = None;
        let args = build_ffmpeg_args(&options);
        let vf_pos = args.iter().position(|a| a == "-vf").unwrap();
        assert_eq!(args[vf_pos + 1], "fps=15");
    }

    #[test]
    fn build_args_puts_ss_before_input_and_t_after() {
        let args = build_ffmpeg_args(&gif_options(GifFormat::Gif, "out.gif"));
        let ss_pos = args.iter().position(|a| a == "-ss").unwrap();
        let i_pos = args.iter().position(|a| a == "-i").unwrap();
        let t_pos = args.iter().position(|a| a == "-t").unwrap();
        assert!(ss_pos < i_pos);
        assert!(t_pos > i_pos);
        assert!(args.contains(&"10.000".to_string()));
        assert!(args.contains(&"30.000".to_string())); // duration = 40 - 10
    }

    #[test]
    fn build_args_zero_start_omits_ss() {
        let mut options = gif_options(GifFormat::Gif, "out.gif");
        options.start_time = 0.0;
        let args = build_ffmpeg_args(&options);
        assert!(!args.iter().any(|a| a == "-ss"));
        assert!(args.contains(&"40.000".to_string()));
    }

    #[test]
    fn build_args_always_includes_progress_flags() {
        let args = build_ffmpeg_args(&gif_options(GifFormat::Gif, "out.gif"));
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.contains(&"-stats_period".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:2".to_string()));
        // Autorotate must stay enabled (default): rotation is burned into
        // the pixels so portrait sources stay portrait in GIF/WebM output.
        assert!(!args.iter().any(|a| a == "-noautorotate"));
    }

    #[test]
    fn has_extension_matches_format_case_insensitively() {
        assert!(has_extension(Path::new("out.gif"), "gif"));
        assert!(has_extension(Path::new("out.GIF"), "gif"));
        assert!(has_extension(Path::new("VIDEO.MP4"), "mp4"));
        assert!(!has_extension(Path::new("out.gif"), "webm"));
        assert!(!has_extension(Path::new("out"), "gif"));
    }

    // ---- executor E2E (issue #646) ----
    //
    // The fake ffmpeg writes a sentinel to the output path on success, so
    // assertions target the file, never stderr (PR #619/#624 flake lesson).

    #[cfg(unix)]
    use crate::utils::ffmpeg_probe::write_fake_ffmpeg_executor;

    fn gif_fixture(dir: &std::path::Path, name: &str) -> String {
        let input = dir.join(name);
        std::fs::write(&input, b"input").unwrap();
        input.to_string_lossy().into_owned()
    }

    /// E2E default options against a real tempdir input file (trim-style
    /// helper: tests mutate fields for their specific scenario).
    fn gif_e2e_options(input: &str, output: &str) -> GifOptions {
        GifOptions {
            input_path: input.to_string(),
            start_time: 1.0,
            end_time: 5.0,
            output_path: output.to_string(),
            format: GifFormat::Gif,
            width: None,
            fps: 15,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn generate_animation_with_ffmpeg_writes_output_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 0, false);
        let input = gif_fixture(dir.path(), "in.mp4");
        let output = dir.path().join("out.gif");
        let mut options = gif_e2e_options(&input, &output.to_string_lossy());
        options.width = Some(480);

        let app = tauri::test::mock_app();
        let result = generate_animation_with_ffmpeg(&ffmpeg, app.handle(), &options)
            .await
            .unwrap();

        assert_eq!(result.output_path, output.to_string_lossy());
        assert_eq!(
            std::fs::read(&output).unwrap(),
            b"fake-ffmpeg-output\n",
            "fake wrote the sentinel"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn generate_animation_with_ffmpeg_maps_failure_to_err_code() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 1, false);
        let input = gif_fixture(dir.path(), "in.mp4");
        let output = dir.path().join("out.gif");
        let options = gif_e2e_options(&input, &output.to_string_lossy());

        let app = tauri::test::mock_app();
        let err = generate_animation_with_ffmpeg(&ffmpeg, app.handle(), &options)
            .await
            .unwrap_err();
        assert!(err.starts_with("ERR::GIF_FFMPEG_FAILED"), "got: {err}");
    }

    #[tokio::test]
    async fn generate_animation_with_ffmpeg_rejects_extension_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let input = gif_fixture(dir.path(), "in.mp4");
        let output = dir.path().join("out.mp4");
        let options = gif_e2e_options(&input, &output.to_string_lossy());

        let app = tauri::test::mock_app();
        let err = generate_animation_with_ffmpeg(
            &dir.path().join("nonexistent-ffmpeg"),
            app.handle(),
            &options,
        )
        .await
        .unwrap_err();
        assert!(
            err.starts_with("ERR::GIF_UNSUPPORTED_OUTPUT_FORMAT"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn generate_animation_with_ffmpeg_rejects_inverted_range() {
        let dir = tempfile::tempdir().unwrap();
        let input = gif_fixture(dir.path(), "in.mp4");
        let output = dir.path().join("out.gif");
        let mut options = gif_e2e_options(&input, &output.to_string_lossy());
        options.start_time = 5.0;
        options.end_time = 1.0;

        let app = tauri::test::mock_app();
        let err = generate_animation_with_ffmpeg(
            &dir.path().join("nonexistent-ffmpeg"),
            app.handle(),
            &options,
        )
        .await
        .unwrap_err();
        assert!(err.starts_with("ERR::GIF_INVALID_RANGE"), "got: {err}");
    }

    #[tokio::test]
    async fn generate_animation_with_ffmpeg_spawn_failure_maps_to_err_code() {
        let dir = tempfile::tempdir().unwrap();
        let input = gif_fixture(dir.path(), "in.mp4");
        let output = dir.path().join("out.gif");
        let options = gif_e2e_options(&input, &output.to_string_lossy());
        let app = tauri::test::mock_app();
        let err = generate_animation_with_ffmpeg(
            &dir.path().join("nonexistent-ffmpeg"),
            app.handle(),
            &options,
        )
        .await
        .unwrap_err();
        assert!(
            err.starts_with("ERR::GIF_FFMPEG_FAILED: spawn"),
            "got: {err}"
        );
    }
}
