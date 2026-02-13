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
}

/// Individual video part with quality and metadata information.
///
/// Represents a single part of a potentially multi-part video.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPart {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
    pub thumbnail: Thumbnail,
    pub video_qualities: Vec<Quality>,
    pub audio_qualities: Vec<Quality>,
}
/// Thumbnail information including both URL and Base64-encoded data.
///
/// Provides flexibility for the frontend to use either the URL or embedded data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    /// Original thumbnail URL
    pub url: String,
    /// Base64-encoded thumbnail image data
    pub base64: String,
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
}

// ============================================================================
// Favorite DTOs
// ============================================================================

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

// ============================================================================
// Watch History DTOs
// ============================================================================

/// Watch history entry sent to the frontend.
///
/// Contains video metadata and viewing progress information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryEntry {
    pub title: String,
    pub cover: String,
    pub cover_base64: String,
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
