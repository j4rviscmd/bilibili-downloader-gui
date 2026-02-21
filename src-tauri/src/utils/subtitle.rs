//! Subtitle utilities for BCC format conversion
//!
//! This module handles downloading and converting Bilibili's BCC subtitle
//! format to standard SRT format for ffmpeg integration.

use crate::models::bilibili_api::BccSubtitle;

/// Converts BCC subtitle format to SRT format.
///
/// BCC format uses `from`/`to` fields in seconds, while SRT uses
/// `HH:MM:SS,mmm --> HH:MM:SS,mmm` timestamp format.
pub fn bcc_to_srt(bcc: &BccSubtitle) -> String {
    bcc.body
        .iter()
        .enumerate()
        .map(|(i, entry)| {
            let start = format_srt_time(entry.from);
            let end = format_srt_time(entry.to);
            format!("{}\n{} --> {}\n{}\n", i + 1, start, end, entry.content)
        })
        .collect::<Vec<_>>()
        .join("\n")
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
pub fn lan_to_iso639(lan: &str) -> &'static str {
    match lan {
        "zh-CN" | "zh-Hans" => "chi",
        "zh-TW" | "zh-Hant" => "chi",
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
        "id" => "ind",
        "ms" => "msa",
        _ => "und",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(lan_to_iso639("en"), "eng");
        assert_eq!(lan_to_iso639("ja"), "jpn");
        assert_eq!(lan_to_iso639("unknown"), "und");
    }
}
