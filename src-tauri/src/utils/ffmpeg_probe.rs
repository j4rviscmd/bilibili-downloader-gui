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

/// Probes the audio stream bitrate of `input_path` in kbps by running
/// `ffmpeg -i` and parsing the trailing `<n> kb/s` on the `Audio:` line.
///
/// Returns `None` when no concrete bitrate is reported (e.g. VBR streams
/// where ffmpeg prints no value or `N/A`).
pub async fn probe_audio_bitrate_kbps(ffmpeg_path: &Path, input_path: &str) -> Option<u32> {
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
        // Match the audio stream line, e.g.:
        //   Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo, fltp, 192 kb/s
        if line.contains("Audio:") {
            if let Some(kbps) = parse_trailing_kbps(line) {
                return Some(kbps);
            }
        }
    }
    None
}

/// Extracts the trailing `<n> kb/s` value from an ffmpeg stream line.
///
/// Finds the last `kb/s` occurrence and parses the number immediately
/// preceding it. Returns `None` if no numeric value is present.
fn parse_trailing_kbps(line: &str) -> Option<u32> {
    let kb_index = line.rfind("kb/s")?;
    let before = &line[..kb_index];
    // The bitrate is the last numeric token before "kb/s".
    let token = before
        .rsplit([',', ' '])
        .find(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))?;
    token.parse::<u32>().ok()
}
