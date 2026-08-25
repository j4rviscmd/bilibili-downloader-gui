//! Frontend Data Transfer Objects (DTOs)
//!
//! This module defines data structures sent to the frontend, including
//! user information, video metadata, and quality options.

use serde::{Deserialize, Serialize};

/// User information structure sent to the frontend.
///
/// Contains authentication status and basic profile information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub code: i32,
    pub message: String,
    pub data: UserData,
    /// Indicates whether valid Bilibili cookies are available
    #[serde(default)]
    pub has_cookie: bool,
}

/// User profile data portion of the User structure.
///
/// Contains authentication status and username information
/// extracted from Bilibili API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    /// User's member ID
    pub mid: Option<i64>,
    /// Username (display name) of the logged-in user
    pub uname: Option<String>,
    /// Authentication status flag
    #[serde(rename = "isLogin")]
    pub is_login: bool,
}

/// Video metadata structure sent to the frontend.
///
/// Contains complete video information including all parts and quality options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    /// Video title
    pub title: String,
    /// Bilibili video ID (BV identifier)
    pub bvid: String,
    /// List of video parts (for multi-part videos)
    pub parts: Vec<VideoPart>,
    /// Indicates whether quality options are limited due to missing cookies
    #[serde(default)]
    pub is_limited_quality: bool,
    /// Content type ("video" or "bangumi")
    #[serde(default = "default_content_type")]
    pub content_type: String,
    /// Episode ID for bangumi content
    #[serde(default)]
    pub ep_id: Option<i64>,
    /// Season title for bangumi content
    #[serde(default)]
    pub season_title: Option<String>,
}

fn default_content_type() -> String {
    "video".to_string()
}

/// Individual video part with quality and metadata information.
///
/// Represents a single part of a potentially multi-part video.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPart {
    pub cid: i64,
    pub page: i32,
    /// Original part name from Bilibili (for display)
    pub part: String,
    /// Sanitized part name with special character replacement and duplicate avoidance (for download filename)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitized_part: Option<String>,
    pub duration: i64,
    pub thumbnail: Thumbnail,
    pub video_qualities: Vec<Quality>,
    pub audio_qualities: Vec<Quality>,
    /// Available subtitles for this part
    #[serde(default)]
    pub subtitles: Vec<SubtitleDto>,
    /// Episode ID for bangumi content
    #[serde(default)]
    pub ep_id: Option<i64>,
    /// Episode status (2=free, 13=VIP-only) for bangumi
    #[serde(default)]
    pub status: Option<i32>,
    /// AID for bangumi content
    #[serde(default)]
    pub aid: Option<i64>,
    /// Preview mode flag (only first 6 minutes available)
    #[serde(default)]
    pub is_preview: Option<bool>,
}
/// Thumbnail information with the image URL.
///
/// The frontend uses the URL directly with referrerPolicy="no-referrer"
/// to bypass Bilibili's hotlink protection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    /// Original thumbnail URL
    pub url: String,
}

/// Quality option for video or audio streams.
///
/// Represents an available quality level with codec information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quality {
    /// Quality ID (higher numbers typically indicate better quality)
    pub id: i32,
    /// Codec ID
    pub codecid: i16,
    /// Human-readable quality label (e.g. "1080P 高清")
    pub quality: String,
}

// Favorite DTOs

/// Favorite folder information sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFolder {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub cover: Option<String>,
    pub media_count: i64,
    #[serde(default)]
    pub upper: Option<FavoriteFolderUpperDto>,
}

/// Upper (creator) information for favorite folder DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFolderUpperDto {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// Favorite video item sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteVideo {
    pub id: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub duration: i64,
    pub page: i32,
    pub upper: FavoriteVideoUpperDto,
    pub attr: i32,
    pub play_count: i64,
    pub collect_count: i64,
    pub link: String,
}

/// Upper (uploader) information for favorite video DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteVideoUpperDto {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// Paginated favorite video list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteVideoListResponse {
    pub videos: Vec<FavoriteVideo>,
    pub has_more: bool,
    pub total_count: i64,
}

// Watch History DTOs

/// Watch history entry sent to the frontend.
///
/// Contains video metadata and viewing progress information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryEntry {
    pub title: String,
    pub cover: String,
    pub bvid: String,
    pub cid: i64,
    pub page: i32,
    pub view_at: i64,
    pub duration: i64,
    pub progress: i64,
    pub url: String,
}

/// Pagination cursor for watch history.
///
/// Used to fetch additional pages of watch history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryCursor {
    pub view_at: i64,
    pub max: i64,
    pub is_end: bool,
}

// Subtitle DTOs

/// Subtitle information sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleDto {
    /// Language code (e.g., "zh-CN", "en")
    pub lan: String,
    /// Language display text (e.g., "中文（简体）")
    pub lan_doc: String,
    /// Subtitle URL (BCC JSON format)
    pub subtitle_url: String,
    /// Whether this is an AI-generated subtitle
    pub is_ai: bool,
    /// AI subtitle type: 0 = legacy AI subtitle, 1 = translated AI subtitle.
    /// None for manually created subtitles.
    pub ai_type: Option<u8>,
}

/// Retry state notification sent to the frontend.
///
/// Emitted via the `download-retrying` event when `retry_download` starts
/// a new attempt after a failure. Unlike the `progress` event, this only
/// carries retry state, leaving all other progress fields untouched on the
/// frontend. This avoids side effects where re-sending a full `Progress`
/// payload would reset `filesize`/`downloaded` to `None`.
///
/// CDN rotation inside `download_url` does NOT use this event; it sets
/// `is_retrying` directly on the `Progress` payload via `Emits::set_retrying`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRetrying {
    /// Unique identifier for this download operation
    pub download_id: String,
    /// Current download stage (e.g., "audio", "video"). When `None`, the
    /// frontend applies the retry state to all stages for this download.
    pub stage: Option<String>,
    /// Whether the download is currently retrying
    pub is_retrying: bool,
}

// Why: these DTOs are the Tauri→frontend wire contract consumed by TS types
// (e.g. src/features/video/types.ts) with no compile-time cross-language
// check; these tests make a camelCase rename fail here instead of silently
// breaking the frontend at runtime.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_renames_is_login_and_defaults_has_cookie() {
        let json = r#"{
            "code": 0, "message": "0",
            "data": { "mid": 7, "uname": "u", "isLogin": true }
        }"#;
        let user: User = serde_json::from_str(json).unwrap();
        assert!(user.data.is_login, "isLogin rename");
        assert_eq!(user.data.mid, Some(7));
        assert!(!user.has_cookie, "absent has_cookie defaults to false");

        let out = serde_json::to_value(&user).unwrap();
        assert_eq!(out["data"]["isLogin"], true);
        assert_eq!(out["hasCookie"], false);
    }

    fn sample_video() -> Video {
        Video {
            title: "t".into(),
            bvid: "BV1xx".into(),
            parts: vec![VideoPart {
                cid: 11,
                page: 1,
                part: "P1".into(),
                sanitized_part: None,
                duration: 60,
                thumbnail: Thumbnail {
                    url: "http://thumb".into(),
                },
                video_qualities: vec![Quality {
                    id: 80,
                    codecid: 7,
                    quality: "1080P".into(),
                }],
                audio_qualities: vec![],
                subtitles: vec![SubtitleDto {
                    lan: "zh-CN".into(),
                    lan_doc: "中文（简体）".into(),
                    subtitle_url: "http://sub.bcc".into(),
                    is_ai: true,
                    ai_type: Some(0),
                }],
                ep_id: None,
                status: None,
                aid: None,
                is_preview: None,
            }],
            is_limited_quality: true,
            content_type: "bangumi".into(),
            ep_id: Some(3051843),
            season_title: Some("Season".into()),
        }
    }

    #[test]
    fn video_roundtrips_camel_case() {
        let video = sample_video();
        let out = serde_json::to_value(&video).unwrap();
        assert_eq!(out["title"], "t");
        assert_eq!(out["bvid"], "BV1xx");
        assert_eq!(out["isLimitedQuality"], true);
        assert_eq!(out["contentType"], "bangumi");
        assert_eq!(out["epId"], 3051843);
        assert_eq!(out["seasonTitle"], "Season");

        let part = &out["parts"][0];
        assert_eq!(part["cid"], 11);
        assert_eq!(part["sanitizedPart"], serde_json::Value::Null);
        assert_eq!(part["subtitles"][0]["subtitleUrl"], "http://sub.bcc");
        assert_eq!(part["subtitles"][0]["aiType"], 0);

        let back: Video = serde_json::from_value(out).unwrap();
        assert_eq!(back.parts.len(), 1);
        assert_eq!(back.parts[0].video_qualities[0].quality, "1080P");
        assert!(back.parts[0].subtitles[0].is_ai);
    }

    #[test]
    fn video_defaults_content_type_video() {
        let json = r#"{
            "title": "t", "bvid": "BV1x",
            "parts": [{ "cid": 1, "page": 1, "part": "p", "duration": 1,
                        "thumbnail": { "url": "u" },
                        "videoQualities": [], "audioQualities": [] }]
        }"#;
        let video: Video = serde_json::from_str(json).unwrap();
        assert_eq!(video.content_type, "video");
        assert!(!video.is_limited_quality);
        assert!(video.ep_id.is_none());
        assert!(video.season_title.is_none());
        assert!(video.parts[0].subtitles.is_empty());
        assert!(video.parts[0].sanitized_part.is_none());
    }

    #[test]
    fn video_part_omits_sanitized_when_none() {
        let video = sample_video();
        let json = serde_json::to_string(&video).unwrap();
        assert!(
            !json.contains("sanitizedPart"),
            "skip_serializing_if drops the key when None"
        );
    }

    #[test]
    fn favorite_dtos_roundtrip_camel_case() {
        let resp = FavoriteVideoListResponse {
            videos: vec![FavoriteVideo {
                id: 1,
                bvid: "BV1f".into(),
                title: "v".into(),
                cover: "c".into(),
                duration: 90,
                page: 1,
                upper: FavoriteVideoUpperDto {
                    mid: 2,
                    name: "up".into(),
                    face: "f".into(),
                },
                attr: 0,
                play_count: 10,
                collect_count: 3,
                link: "l".into(),
            }],
            has_more: true,
            total_count: 1,
        };
        let out = serde_json::to_value(&resp).unwrap();
        assert_eq!(out["hasMore"], true);
        assert_eq!(out["totalCount"], 1);
        assert_eq!(out["videos"][0]["playCount"], 10);

        let folder = FavoriteFolder {
            id: 9,
            title: "default".into(),
            cover: None,
            media_count: 4,
            upper: None,
        };
        let folder_out = serde_json::to_value(&folder).unwrap();
        assert_eq!(folder_out["mediaCount"], 4);
        assert_eq!(folder_out["cover"], serde_json::Value::Null);
        assert_eq!(folder_out["upper"], serde_json::Value::Null);
    }

    #[test]
    fn watch_history_entry_serializes_camel_case() {
        let entry = WatchHistoryEntry {
            title: "t".into(),
            cover: "c".into(),
            bvid: "BV1w".into(),
            cid: 5,
            page: 2,
            view_at: 1700000000,
            duration: 100,
            progress: 50,
            url: "u".into(),
        };
        let out = serde_json::to_value(&entry).unwrap();
        assert_eq!(out["viewAt"], 1700000000);
        assert_eq!(out["bvid"], "BV1w");

        let cursor = WatchHistoryCursor {
            view_at: 1,
            max: 2,
            is_end: true,
        };
        let cursor_out = serde_json::to_value(&cursor).unwrap();
        assert_eq!(cursor_out["viewAt"], 1);
        assert_eq!(cursor_out["isEnd"], true);
    }

    #[test]
    fn download_retrying_serializes_camel_case() {
        let evt = DownloadRetrying {
            download_id: "dl-1".into(),
            stage: Some("video".into()),
            is_retrying: true,
        };
        let out = serde_json::to_value(&evt).unwrap();
        assert_eq!(out["downloadId"], "dl-1");
        assert_eq!(out["stage"], "video");
        assert_eq!(out["isRetrying"], true);
    }
}
