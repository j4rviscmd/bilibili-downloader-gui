//! Frontend Data Transfer Objects (DTOs)
//!
//! This module defines data structures sent to the frontend, including
//! user information, video metadata, and quality options.

use serde::{Deserialize, Serialize};

/// User information structure sent to the frontend.
///
/// Contains authentication status and basic profile information.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct VideoPart {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
    pub thumbnail: Thumbnail,
    #[serde(rename = "videoQualities")]
    pub video_qualities: Vec<Quality>,
    #[serde(rename = "audioQualities")]
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
