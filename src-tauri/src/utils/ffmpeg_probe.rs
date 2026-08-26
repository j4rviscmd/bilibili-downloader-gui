//! FFmpeg Probe Utilities
//!
//! Helpers for probing media file metadata (duration, etc.) using ffmpeg.

use super::ffmpeg_progress::parse_hhmmss;
use serde::Serialize;
use std::path::Path;
use tokio::process::Command as AsyncCommand;

/// Video resolution dimensions.
#[derive(Debug, Clone, Serialize)]
pub struct VideoResolution {
    pub width: u32,
    pub height: u32,
}

/// Probes the video stream resolution (width × height) of `input_path` by
/// running `ffmpeg -i` and parsing the `<W>x<H>` token on the `Video:` line
/// from stderr.
///
/// Mirrors {@link probe_audio_bitrate_kbps}: the bundled ffmpeg-only build
/// ships no `ffprobe` binary, so we reuse the same `ffmpeg -i` stderr scrape
/// instead of relying on a separate ffprobe invocation. Returns `None` when
/// no video stream is found or the dimensions cannot be parsed.
pub async fn probe_video_resolution(
    ffmpeg_path: &Path,
    input_path: &str,
) -> Option<VideoResolution> {
    let mut cmd = AsyncCommand::new(ffmpeg_path);
    cmd.arg("-i").arg(input_path);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // `ffmpeg -i` with no output exits non-zero, but still prints the input's
    // stream metadata to stderr — which is exactly what we parse.
    let output = cmd.output().await.ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        // Match the video stream line, e.g.:
        //   Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], ...
        if line.contains("Video:") {
            if let Some((width, height)) = parse_resolution(line) {
                return Some(VideoResolution { width, height });
            }
        }
    }
    None
}

/// Extracts the first `<W>x<H>` token from an ffmpeg stream line.
///
/// Splits on whitespace/commas and finds a token whose two numeric halves are
/// joined by `x` (e.g. `1920x1080`). Returns `None` if no such token exists.
fn parse_resolution(line: &str) -> Option<(u32, u32)> {
    for token in line.split([' ', ',']) {
        if let Some(idx) = token.find('x') {
            let (w, rest) = token.split_at(idx);
            let h = &rest[1..]; // skip the 'x'
            if let (Ok(width), Ok(height)) = (w.parse::<u32>(), h.parse::<u32>()) {
                if width > 0 && height > 0 {
                    return Some((width, height));
                }
            }
        }
    }
    None
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_resolution_finds_width_x_height_token() {
        assert_eq!(
            parse_resolution("Stream #0:0[0x1](und): Video: h264, 1920x1080 [SAR 1:1]"),
            Some((1920, 1080))
        );
        assert_eq!(parse_resolution("640x360"), Some((640, 360)));
        assert_eq!(parse_resolution("no dims here"), None);
    }

    #[test]
    fn parse_resolution_rejects_zero_dims() {
        // 0x0 streams (audio-only) must not be mistaken for video dims.
        assert_eq!(parse_resolution("0x0"), None);
        assert_eq!(parse_resolution("1920x0"), None);
    }

    #[test]
    fn parse_trailing_kbps_takes_last_number_before_unit() {
        assert_eq!(
            parse_trailing_kbps("Video: h264, 1920x1080, 5000 kb/s, 30 fps"),
            Some(5000)
        );
        assert_eq!(parse_trailing_kbps("Audio: aac, 320 kb/s"), Some(320));
        assert_eq!(parse_trailing_kbps("no bitrate"), None);
        assert_eq!(parse_trailing_kbps("kb/s"), None);
    }

    /// Writes a fake "ffmpeg" executable that prints the given stderr and
    /// exits, so probe_duration_sec / probe_audio_bitrate_kbps can be tested
    /// without a real ffmpeg binary.
    #[cfg(unix)]
    fn write_fake_ffmpeg(dir: &std::path::Path, stderr_text: &str) -> std::path::PathBuf {
        let script = format!("#!/bin/sh\ncat 1>&2 <<'EOF'\n{stderr_text}\nEOF\nexit 0\n");
        let path = dir.join("fake-ffmpeg");
        std::fs::write(&path, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_duration_parses_ffmpeg_stderr_line() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg(
            dir.path(),
            "Input #0, mov,mp4,m4a, from 'x.mp4':\n  Duration: 00:01:02.75, start: 0.000000, bitrate: 5000 kb/s\n",
        );
        let secs = probe_duration_sec(&ffmpeg, "x.mp4").await;
        assert_eq!(secs, Some(62.75));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_duration_missing_line_yields_none() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg(dir.path(), "no duration info here\n");
        assert!(probe_duration_sec(&ffmpeg, "x.mp4").await.is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_audio_bitrate_takes_audio_line_value() {
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg(
            dir.path(),
            "  Duration: 00:01:02.75, start: 0.000000, bitrate: 5000 kb/s\n  Stream #0:1[0x2](und): Audio: aac (LC), 44100 Hz, stereo, fltp, 192 kb/s\n",
        );
        // The Video line's 5000 kb/s must NOT win; the Audio line's 192 does.
        assert_eq!(probe_audio_bitrate_kbps(&ffmpeg, "x.mp4").await, Some(192));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_audio_bitrate_na_falls_back_to_preceding_number() {
        // Why: pins ACTUAL behavior — for "N/A kb/s" the parser grabs the
        // last all-digit token before "kb/s" (the sample rate 44100), NOT
        // None as the doc comment on parse_trailing_kbps claims. Kept as-is
        // in this refactor PR; flagged for a follow-up fix decision.
        let dir = tempfile::tempdir().unwrap();
        let ffmpeg = write_fake_ffmpeg(
            dir.path(),
            "  Stream #0:1: Audio: flac, 44100 Hz, stereo, N/A kb/s\n",
        );
        assert_eq!(
            probe_audio_bitrate_kbps(&ffmpeg, "x.mp4").await,
            Some(44100)
        );
    }
}
