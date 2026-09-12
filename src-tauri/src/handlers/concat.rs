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

    // Why pid + atomic counter: the millisecond timestamp alone collided when
    // parallel callers (cargo test threads, or two app instances using the
    // multi-process parallel download feature) wrote a list in the same
    // millisecond — one overwrote the other's content.
    static LIST_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let seq = LIST_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let list_path = dir.join(format!(
        "filelist_{}_{}_{seq}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        std::process::id()
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
async fn run_ffmpeg_with_progress<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
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
    concat_videos_with_ffmpeg(&get_ffmpeg_path(app), app, options).await
}

/// Path-injected split of [`concat_videos`] (test seam, issue #646): runs
/// the same probe→list→copy→fallback-reencode flow against an explicit
/// ffmpeg binary so tests drive it with a fake script in a tempdir.
// Why: generic over R, not the default-Wry `&AppHandle`, because the E2E tests
// below pass `tauri::test::mock_app().handle()` (`AppHandle<MockRuntime>`,
// tauri "test" feature in src-tauri/Cargo.toml), which only type-checks
// against a generic Runtime param (issue #646).
pub(crate) async fn concat_videos_with_ffmpeg<R: tauri::Runtime>(
    ffmpeg_path: &Path,
    app: &tauri::AppHandle<R>,
    options: &ConcatOptions,
) -> Result<ConcatResult, String> {
    let output_path = Path::new(&options.output_path);

    validate_inputs(&options.input_paths, output_path)?;

    // Probe total duration across all input files
    let mut total_duration: f64 = 0.0;
    for p in &options.input_paths {
        if let Some(d) = probe_duration_sec(ffmpeg_path, p).await {
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
        ffmpeg_path,
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
        ffmpeg_path,
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
    // ---- R6: validation and path helpers ----

    fn touch_mp4(dir: &std::path::Path, name: &str) -> String {
        let p = dir.join(name);
        std::fs::write(&p, b"x").unwrap();
        p.to_str().unwrap().to_string()
    }

    #[test]
    fn validate_inputs_requires_at_least_two_files() {
        let tmp = tempfile::tempdir().unwrap();
        let one = touch_mp4(tmp.path(), "a.mp4");
        let out = tmp.path().join("out.mp4");
        assert_eq!(
            validate_inputs(&[one], &out).unwrap_err(),
            "ERR::CONCAT_TOO_FEW_FILES"
        );
        assert_eq!(
            validate_inputs(&[], &out).unwrap_err(),
            "ERR::CONCAT_TOO_FEW_FILES"
        );
    }

    #[test]
    fn validate_inputs_rejects_missing_and_non_mp4_inputs() {
        let tmp = tempfile::tempdir().unwrap();
        let good = touch_mp4(tmp.path(), "a.mp4");
        let out = tmp.path().join("out.mp4");

        let missing = tmp.path().join("ghost.mp4").to_str().unwrap().to_string();
        assert_eq!(
            validate_inputs(&[good.clone(), missing], &out).unwrap_err(),
            "ERR::CONCAT_FILE_NOT_FOUND"
        );

        let bad = tmp.path().join("b.mkv");
        std::fs::write(&bad, b"x").unwrap();
        assert_eq!(
            validate_inputs(&[good, bad.to_str().unwrap().to_string()], &out).unwrap_err(),
            "ERR::CONCAT_UNSUPPORTED_FORMAT"
        );
    }

    #[test]
    fn validate_inputs_rejects_output_collision_and_bad_output_ext() {
        let tmp = tempfile::tempdir().unwrap();
        let a = touch_mp4(tmp.path(), "a.mp4");
        let b = touch_mp4(tmp.path(), "b.mp4");

        // An input that IS the output collides
        let out_as_input = tmp.path().join("out.mp4");
        std::fs::write(&out_as_input, b"x").unwrap();
        assert_eq!(
            validate_inputs(
                &[a.clone(), out_as_input.to_str().unwrap().to_string()],
                &out_as_input
            )
            .unwrap_err(),
            "ERR::CONCAT_OUTPUT_COLLISION"
        );

        // Output must be .mp4
        let bad_out = tmp.path().join("out.mkv");
        assert_eq!(
            validate_inputs(&[a, b], &bad_out).unwrap_err(),
            "ERR::CONCAT_UNSUPPORTED_OUTPUT_FORMAT"
        );
    }

    #[test]
    fn validate_inputs_accepts_two_distinct_mp4s() {
        let tmp = tempfile::tempdir().unwrap();
        let a = touch_mp4(tmp.path(), "a.mp4");
        let b = touch_mp4(tmp.path(), "b.mp4");
        let out = tmp.path().join("out.mp4");
        assert!(validate_inputs(&[a, b], &out).is_ok());
    }

    #[test]
    fn is_same_file_prefers_canonical_and_falls_back_lexical() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.mp4");
        std::fs::write(&a, b"x").unwrap();

        assert!(is_same_file(&a, &a));
        // Note: the parent-canonicalization fallback's positive direction
        // (existing input vs. lexically-different nonexistent output that
        // resolves equal) is NOT exercised here — a plain re-spelling of the
        // same existing path canonicalizes directly, so it duplicates the
        // assert above. Covered indirectly via validate_inputs collision.
        assert!(!is_same_file(&a, &tmp.path().join("b.mp4")));

        // Two nonexistent paths fall back to lexical equality
        let ghost1 = tmp.path().join("ghost.mp4");
        assert!(is_same_file(&ghost1, &tmp.path().join("ghost.mp4")));
    }

    #[test]
    fn canonicalize_with_parent_rejoins_filename() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("not-yet.mp4");
        let canon = canonicalize_with_parent(&p).unwrap();
        assert_eq!(canon.file_name().unwrap(), "not-yet.mp4");
        // Parent must resolve to the real (canonicalized) temp dir
        assert_eq!(
            canon.parent().unwrap(),
            std::fs::canonicalize(tmp.path()).unwrap().as_path()
        );
    }

    #[test]
    fn cleanup_list_removes_file_and_owned_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("bilibili-dl-concat");
        std::fs::create_dir_all(&dir).unwrap();
        let list = dir.join("filelist_1.txt");
        std::fs::write(&list, b"x").unwrap();

        cleanup_list(&list);
        assert!(!list.exists());
        assert!(!dir.exists(), "owned empty dir removed");

        // A list outside bilibili-dl-concat must not nuke its parent
        let other_dir = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&other_dir).unwrap();
        let other = other_dir.join("filelist.txt");
        std::fs::write(&other, b"x").unwrap();
        cleanup_list(&other);
        assert!(other_dir.exists(), "foreign parent kept");
    }

    // ---- PR⑧: executor E2E (issue #646) ----
    //
    // The fake ffmpeg writes a sentinel to the output path on success and
    // `fail_on_copy` makes stream-copy invocations exit 1, driving the
    // re-encode fallback. Assertions target the output file, never stderr
    // (PR #619/#624 flake lesson).

    #[cfg(unix)]
    use crate::utils::ffmpeg_probe::write_fake_ffmpeg_executor;

    fn concat_fixture(dir: &std::path::Path, count: usize) -> Vec<String> {
        (0..count)
            .map(|i| {
                let p = dir.join(format!("in{i}.mp4"));
                std::fs::write(&p, b"input").unwrap();
                p.to_string_lossy().into_owned()
            })
            .collect()
    }

    fn concat_options(inputs: &[String], output: &str) -> ConcatOptions {
        ConcatOptions {
            input_paths: inputs.to_vec(),
            output_path: output.to_string(),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn concat_videos_with_ffmpeg_copy_success_writes_output() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 0, false);
        let inputs = concat_fixture(dir.path(), 2);
        let output = dir.path().join("out.mp4");

        let app = tauri::test::mock_app();
        let result = concat_videos_with_ffmpeg(
            &ffmpeg,
            app.handle(),
            &concat_options(&inputs, &output.to_string_lossy()),
        )
        .await
        .unwrap();

        assert_eq!(result.output_path, output.to_string_lossy());
        assert_eq!(std::fs::read(&output).unwrap(), b"fake-ffmpeg-output\n");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn concat_videos_with_ffmpeg_falls_back_to_reencode() {
        // copy fails -> fallback event + re-encode attempt (which succeeds
        // because its args carry -c:v, not " copy ").
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 0, true);
        let inputs = concat_fixture(dir.path(), 2);
        let output = dir.path().join("out.mp4");

        let app = tauri::test::mock_app();
        let result = concat_videos_with_ffmpeg(
            &ffmpeg,
            app.handle(),
            &concat_options(&inputs, &output.to_string_lossy()),
        )
        .await
        .unwrap();

        assert_eq!(result.output_path, output.to_string_lossy());
        assert!(output.exists(), "re-encode wrote the output");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn concat_videos_with_ffmpeg_both_attempts_failing_errors() {
        let dir = tempfile::tempdir().unwrap();
        // copy fails (fail_on_copy) and re-encode fails (exit 1).
        let ffmpeg = write_fake_ffmpeg_executor(dir.path(), 1, true);
        let inputs = concat_fixture(dir.path(), 2);
        let output = dir.path().join("out.mp4");

        let app = tauri::test::mock_app();
        let err = concat_videos_with_ffmpeg(
            &ffmpeg,
            app.handle(),
            &concat_options(&inputs, &output.to_string_lossy()),
        )
        .await
        .unwrap_err();
        assert!(err.starts_with("ERR::CONCAT_REENCODE_FAILED"), "got: {err}");
    }
}
