//! FFmpeg Probe Utilities
//!
//! Helpers for probing media file metadata (duration, etc.) using ffmpeg.

use super::ffmpeg_progress::parse_hhmmss;
use std::path::Path;
use tokio::process::Command as AsyncCommand;

/// Probes the duration of `input_path` in seconds by running `ffmpeg -i`
/// and parsing the `Duration: HH:MM:SS.xx` line from stderr.
///
/// Returns `None` on any parse failure.
pub async fn probe_duration_sec(ffmpeg_path: &Path, input_path: &str) -> Option<f64> {
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
