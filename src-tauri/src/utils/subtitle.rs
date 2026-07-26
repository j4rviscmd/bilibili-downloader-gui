//! Subtitle utilities for BCC format conversion
//!
//! This module handles downloading and converting Bilibili's BCC subtitle
//! format to standard SRT format for ffmpeg integration.

use crate::models::bilibili_api::BccSubtitle;

/// Converts BCC subtitle format to SRT format.
///
/// BCC format uses `from`/`to` fields in seconds, while SRT uses
/// `HH:MM:SS,mmm --> HH:MM:SS,mmm` timestamp format.
///
/// When `max_duration_secs` is `Some(d)` with `d > 0.0`, out-of-range
/// timestamps are clamped to the video duration: cues that start at or
/// after `d` are dropped, and cues that end after `d` are truncated to
/// `d`. Pass `None` to preserve timestamps as-is (e.g. for standalone
/// SRT export without a known video duration).
///
/// The output includes a UTF-8 BOM prefix to ensure correct encoding
/// detection by ffmpeg on Windows.
pub fn bcc_to_srt(bcc: &BccSubtitle, max_duration_secs: Option<f64>) -> String {
    let srt_content = bcc
        .body
        .iter()
        // Clamp out-of-range timestamps. Bilibili AI subtitles may carry
        // cues whose `to` far exceeds the video duration (observed 35x
        // overshoot). Without clamping, these cues inflate the muxed
        // subtitle stream duration and stretch the container runtime.
        .filter_map(|entry| {
            let (from, mut to) = (entry.from, entry.to);
            // Note: The `m > 0.0` guard treats 0.0 as "unknown duration" and
            // disables clamping. `duration_seconds` is an i64 on DownloadOptions
            // cast to f64 at the download_video call site (handlers/bilibili.rs);
            // when it is unset (0), Some(0.0) would otherwise make `from >= max`
            // true for every cue (including from == 0.0) and drop all subtitles.
            if let Some(max) = max_duration_secs.filter(|&m| m > 0.0) {
                if from >= max {
                    // Cue starts after the video ends; drop entirely.
                    return None;
                }
                if to > max {
                    // Cue ends after the video ends; clamp to the end.
                    to = max;
                }
            }
            Some((
                format_srt_time(from),
                format_srt_time(to),
                entry.content.as_str(),
            ))
        })
        .enumerate()
        .map(|(i, (start, end, content))| {
            format!("{}\n{} --> {}\n{}\n", i + 1, start, end, content)
        })
        .collect::<Vec<_>>()
        .join("\n");

    // UTF-8 BOM ensures ffmpeg correctly detects encoding on Windows
    format!("\u{FEFF}{}", srt_content)
}

/// Formats a time in seconds to SRT timestamp format (HH:MM:SS,mmm).
fn format_srt_time(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0) as u64;
    let hours = total_ms / 3_600_000;
    let minutes = (total_ms % 3_600_000) / 60_000;
    let secs = (total_ms % 60_000) / 1000;
    let millis = total_ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

/// Maps Bilibili language codes to ISO 639-2 codes for ffmpeg metadata.
///
/// Supports both simple codes (e.g., "en") and locale variants (e.g., "en-US", "es-419").
/// Also handles AI-generated subtitle codes (e.g., "ai-es" -> "spa").
/// Falls back to base language code if the full code isn't found.
pub fn lan_to_iso639(lan: &str) -> &'static str {
    // Normalize: remove "ai-" prefix for AI-generated subtitles
    let normalized = lan.strip_prefix("ai-").unwrap_or(lan);

    // Full match first
    match normalized {
        // Chinese variants
        "zh-CN" | "zh-Hans" | "zh" => "chi",
        "zh-TW" | "zh-Hant" | "zh-HK" => "chi",
        // English variants
        "en" | "en-US" | "en-GB" | "en-AU" => "eng",
        // Japanese
        "ja" => "jpn",
        // Korean
        "ko" | "ko-KR" => "kor",
        // Spanish variants
        "es" | "es-419" | "es-ES" | "es-MX" | "es-AR" => "spa",
        // French variants
        "fr" | "fr-FR" | "fr-CA" => "fre",
        // German
        "de" | "de-DE" | "de-AT" => "ger",
        // Russian
        "ru" | "ru-RU" => "rus",
        // Portuguese variants
        "pt" | "pt-BR" | "pt-PT" => "por",
        // Italian
        "it" | "it-IT" => "ita",
        // Arabic
        "ar" | "ar-SA" | "ar-EG" => "ara",
        // Thai
        "th" => "tha",
        // Vietnamese
        "vi" => "vie",
        // Indonesian
        "id" | "in" => "ind", // "in" is legacy code for Indonesian
        // Malay
        "ms" | "ms-MY" => "msa",
        _ => {
            // Fallback: try base language code (e.g., "es-419" -> "es")
            if let Some(base) = normalized.split('-').next() {
                match base {
                    "zh" => "chi",
                    "en" => "eng",
                    "ja" => "jpn",
                    "ko" => "kor",
                    "es" => "spa",
                    "fr" => "fre",
                    "de" => "ger",
                    "ru" => "rus",
                    "pt" => "por",
                    "it" => "ita",
                    "ar" => "ara",
                    "th" => "tha",
                    "vi" => "vie",
                    "id" | "in" => "ind",
                    "ms" => "msa",
                    _ => "und",
                }
            } else {
                "und"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::bilibili_api::{BccSubtitle, BccSubtitleBody};

    #[test]
    fn test_format_srt_time() {
        assert_eq!(format_srt_time(0.0), "00:00:00,000");
        assert_eq!(format_srt_time(1.5), "00:00:01,500");
        assert_eq!(format_srt_time(65.123), "00:01:05,123");
        assert_eq!(format_srt_time(3661.999), "01:01:01,999");
    }

    #[test]
    fn test_lan_to_iso639() {
        assert_eq!(lan_to_iso639("zh-CN"), "chi");
        assert_eq!(lan_to_iso639("zh-Hans"), "chi");
        assert_eq!(lan_to_iso639("zh-TW"), "chi");
        assert_eq!(lan_to_iso639("zh-Hant"), "chi");
        assert_eq!(lan_to_iso639("en"), "eng");
        assert_eq!(lan_to_iso639("ja"), "jpn");
        assert_eq!(lan_to_iso639("ko"), "kor");
        assert_eq!(lan_to_iso639("es"), "spa");
        assert_eq!(lan_to_iso639("fr"), "fre");
        assert_eq!(lan_to_iso639("unknown"), "und");
    }

    #[test]
    fn test_bcc_to_srt_single_entry() {
        let bcc = BccSubtitle {
            font_size: 0.4,
            font_color: "0xFFFFFF".to_string(),
            background_alpha: 0.5,
            background_color: "0x000000".to_string(),
            stroke: "none".to_string(),
            body: vec![BccSubtitleBody {
                from: 0.0,
                to: 2.5,
                location: 0,
                content: "Hello world".to_string(),
            }],
        };

        let srt = bcc_to_srt(&bcc, None);
        let expected = "\u{FEFF}1\n00:00:00,000 --> 00:00:02,500\nHello world\n";
        assert_eq!(srt, expected);
    }

    #[test]
    fn test_bcc_to_srt_multiple_entries() {
        let bcc = BccSubtitle {
            font_size: 0.4,
            font_color: "0xFFFFFF".to_string(),
            background_alpha: 0.5,
            background_color: "0x000000".to_string(),
            stroke: "none".to_string(),
            body: vec![
                BccSubtitleBody {
                    from: 0.0,
                    to: 2.5,
                    location: 0,
                    content: "First line".to_string(),
                },
                BccSubtitleBody {
                    from: 3.0,
                    to: 5.5,
                    location: 0,
                    content: "Second line".to_string(),
                },
            ],
        };

        let srt = bcc_to_srt(&bcc, None);
        assert!(srt.contains("1\n00:00:00,000 --> 00:00:02,500\nFirst line"));
        assert!(srt.contains("2\n00:00:03,000 --> 00:00:05,500\nSecond line"));
    }

    #[test]
    fn test_bcc_to_srt_empty_body() {
        let bcc = BccSubtitle {
            font_size: 0.4,
            font_color: "0xFFFFFF".to_string(),
            background_alpha: 0.5,
            background_color: "0x000000".to_string(),
            stroke: "none".to_string(),
            body: vec![],
        };

        let srt = bcc_to_srt(&bcc, None);
        assert_eq!(srt, "\u{FEFF}");
    }

    #[test]
    fn test_bcc_to_srt_clamps_to_max_duration() {
        let bcc = BccSubtitle {
            font_size: 0.4,
            font_color: "0xFFFFFF".to_string(),
            background_alpha: 0.5,
            background_color: "0x000000".to_string(),
            stroke: "none".to_string(),
            body: vec![
                BccSubtitleBody {
                    from: 0.0,
                    to: 2.5,
                    location: 0,
                    content: "inside".to_string(),
                },
                BccSubtitleBody {
                    from: 8.0,
                    to: 100.0, // overshoots the 10s cap -> clamped
                    location: 0,
                    content: "straddles end".to_string(),
                },
                BccSubtitleBody {
                    from: 12.0, // starts after the 10s cap -> dropped
                    to: 15.0,
                    location: 0,
                    content: "after end".to_string(),
                },
            ],
        };

        let srt = bcc_to_srt(&bcc, Some(10.0));
        // First cue untouched, second clamped to 10s, third dropped.
        assert!(srt.contains("1\n00:00:00,000 --> 00:00:02,500\ninside"));
        assert!(srt.contains("2\n00:00:08,000 --> 00:00:10,000\nstraddles end"));
        assert!(!srt.contains("after end"));
    }

    #[test]
    fn test_bcc_to_srt_none_disables_clamp() {
        let bcc = BccSubtitle {
            font_size: 0.4,
            font_color: "0xFFFFFF".to_string(),
            background_alpha: 0.5,
            background_color: "0x000000".to_string(),
            stroke: "none".to_string(),
            body: vec![BccSubtitleBody {
                from: 0.0,
                to: 10000.0, // would be dropped if clamped
                location: 0,
                content: "far".to_string(),
            }],
        };

        // None preserves the original (oversized) timestamp.
        let srt = bcc_to_srt(&bcc, None);
        assert!(srt.contains("00:00:00,000 --> 02:46:40,000"));
        assert!(srt.contains("\nfar"));
    }
}
