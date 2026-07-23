//! Video codec selection utilities.
//!
//! This module provides functionality for selecting video streams based on
//! codec priority preferences. It supports AV1, H.265 (HEVC), and H.264 (AVC)
//! codecs with configurable fallback behavior.

use serde::{Deserialize, Serialize};

/// Video codec IDs as defined by Bilibili DASH API.
///
/// References:
/// - AVC: https://en.wikipedia.org/wiki/Advanced_Video_Coding
/// - HEVC: https://en.wikipedia.org/wiki/High_Efficiency_Video_Coding
/// - AV1: https://en.wikipedia.org/wiki/AV1
pub const CODECID_AVC: i16 = 7;
pub const CODECID_HEVC: i16 = 12;
pub const CODECID_AV1: i16 = 13;

/// Video codec priority preference.
///
/// Determines the order of codec selection with automatic fallback to
/// lower-priority codecs if the preferred codec is not available.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub enum VideoCodecPriority {
    /// Prefer AV1, fallback to H.265, then H.264 (default).
    ///
    /// AV1 provides the best compression efficiency but may not be available
    /// for all videos. This mode offers the smallest file sizes when AV1 is available.
    #[default]
    #[serde(rename = "av1First")]
    Av1First,
    /// Prefer H.265 (HEVC), fallback to H.264 only.
    ///
    /// H.265 offers better compression than H.264 with broader availability than AV1.
    /// This mode balances compression efficiency and compatibility.
    #[serde(rename = "hevcFirst")]
    HevcFirst,
    /// Prefer H.264 (AVC) only.
    ///
    /// H.264 has the widest device and player compatibility but larger file sizes.
    /// This mode prioritizes compatibility over compression efficiency.
    #[serde(rename = "avcOnly")]
    AvcOnly,
}

impl VideoCodecPriority {
    /// Returns codec ID priority list in order of preference.
    ///
    /// # Returns
    ///
    /// A vector of codec IDs ordered from highest to lowest priority.
    ///
    /// # Examples
    ///
    /// ```
    /// use bilibili_downloader_gui_lib::utils::codec::{
    ///     VideoCodecPriority, CODECID_AV1, CODECID_HEVC, CODECID_AVC,
    /// };
    /// let priority = VideoCodecPriority::Av1First;
    /// assert_eq!(priority.codec_ids(), vec![CODECID_AV1, CODECID_HEVC, CODECID_AVC]);
    /// ```
    pub fn codec_ids(&self) -> Vec<i16> {
        // Constraint: fallback is downward-only — the preferred codec is the
        // ceiling. Each list only includes less-compressed (more compatible)
        // codecs below the preference, so e.g. HevcFirst never falls back up
        // to AV1. This bounds file size by the user's stated preference (issue #460).
        match self {
            VideoCodecPriority::Av1First => vec![CODECID_AV1, CODECID_HEVC, CODECID_AVC],
            VideoCodecPriority::HevcFirst => vec![CODECID_HEVC, CODECID_AVC],
            VideoCodecPriority::AvcOnly => vec![CODECID_AVC],
        }
    }
}

/// Result of video stream selection.
///
/// Contains the selected codec ID and whether fallback occurred. The actual
/// stream URL/quality selection is handled separately by `select_stream_url`;
/// this only carries the codec decision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamSelection {
    /// Selected video codec ID.
    pub codecid: i16,
    /// Whether fallback occurred (selected codec differs from first preference).
    pub fallback: bool,
}

/// Selects the best video codec based on priority and available codecs.
///
/// Scans the priority list in order and returns the first codec that is
/// available. `fallback` is true when the selected codec is not the
/// top-preference (i.e. a lower-priority codec was used).
///
/// # Arguments
///
/// * `priority` - Codec priority preference
/// * `available_codecs` - Available codec IDs from DASH streams
///
/// # Returns
///
/// `Some(VideoStreamSelection)` when a priority codec is available,
/// `None` when none of the preferred codecs are available (caller falls
/// back to all streams).
///
/// # Examples
///
/// ```
/// use bilibili_downloader_gui_lib::utils::codec::{
///     select_video_stream, VideoCodecPriority, CODECID_HEVC, CODECID_AVC,
/// };
/// let priority = VideoCodecPriority::Av1First;
/// let available = vec![CODECID_HEVC, CODECID_AVC];
/// let selection = select_video_stream(&priority, &available).unwrap();
/// assert_eq!(selection.codecid, CODECID_HEVC);
/// assert!(selection.fallback);
/// ```
pub fn select_video_stream(
    priority: &VideoCodecPriority,
    available_codecs: &[i16],
) -> Option<VideoStreamSelection> {
    let priority_list = priority.codec_ids();

    for (index, &codecid) in priority_list.iter().enumerate() {
        if available_codecs.contains(&codecid) {
            return Some(VideoStreamSelection {
                codecid,
                fallback: index > 0,
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codec_constants() {
        assert_eq!(CODECID_AVC, 7);
        assert_eq!(CODECID_HEVC, 12);
        assert_eq!(CODECID_AV1, 13);
    }

    #[test]
    fn test_codec_ids() {
        assert_eq!(
            VideoCodecPriority::Av1First.codec_ids(),
            vec![CODECID_AV1, CODECID_HEVC, CODECID_AVC]
        );
        assert_eq!(
            VideoCodecPriority::HevcFirst.codec_ids(),
            vec![CODECID_HEVC, CODECID_AVC]
        );
        assert_eq!(VideoCodecPriority::AvcOnly.codec_ids(), vec![CODECID_AVC]);
    }

    #[test]
    fn test_select_video_stream_av1_available() {
        let priority = VideoCodecPriority::Av1First;
        let available = vec![CODECID_AV1, CODECID_HEVC, CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_AV1);
        assert!(!selection.fallback);
    }

    #[test]
    fn test_select_video_stream_av1_fallback_to_hevc() {
        let priority = VideoCodecPriority::Av1First;
        let available = vec![CODECID_HEVC, CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_HEVC);
        assert!(selection.fallback);
    }

    #[test]
    fn test_select_video_stream_av1_fallback_to_avc() {
        let priority = VideoCodecPriority::Av1First;
        let available = vec![CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_AVC);
        assert!(selection.fallback);
    }

    #[test]
    fn test_select_video_stream_hevc_first_no_fallback() {
        let priority = VideoCodecPriority::HevcFirst;
        let available = vec![CODECID_HEVC, CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_HEVC);
        assert!(!selection.fallback);
    }

    #[test]
    fn test_select_video_stream_hevc_first_fallback_to_avc() {
        let priority = VideoCodecPriority::HevcFirst;
        let available = vec![CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_AVC);
        assert!(selection.fallback);
    }

    #[test]
    fn test_select_video_stream_avc_only_no_fallback() {
        let priority = VideoCodecPriority::AvcOnly;
        let available = vec![CODECID_AVC];

        let selection = select_video_stream(&priority, &available).unwrap();
        assert_eq!(selection.codecid, CODECID_AVC);
        assert!(!selection.fallback);
    }

    #[test]
    fn test_select_video_stream_no_match() {
        let priority = VideoCodecPriority::Av1First;
        let available = vec![999]; // Unknown codec

        let selection = select_video_stream(&priority, &available);
        assert!(selection.is_none());
    }

    #[test]
    fn test_default_codec_priority() {
        let default = VideoCodecPriority::default();
        assert_eq!(default, VideoCodecPriority::Av1First);
    }
}
