//! Bilibili API Response Models
//!
//! This module defines data structures for deserializing responses from
//! various Bilibili API endpoints.

use serde::{Deserialize, Serialize};

/// Response structure from the Bilibili user navigation API.
///
/// API endpoint: `https://api.bilibili.com/x/web-interface/nav`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponse {
    pub code: i32,
    pub message: String,
    pub ttl: u32,
    pub data: UserApiResponseData,
}

/// User data portion of the user navigation API response.
///
/// Contains authentication status and WBI image information used for
/// generating signed API requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponseData {
    pub uname: Option<String>,
    #[serde(rename = "isLogin")]
    pub is_login: bool,
    pub wbi_img: UserApiResponseDataImg,
}

/// WBI (Web Browser Interface) image URLs for request signing.
///
/// Contains the URLs to img_key and sub_key images used in generating
/// signed requests to Bilibili APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponseDataImg {
    pub img_url: String,
    pub sub_url: String,
}

/// Response structure from the Bilibili web interface view API.
///
/// API endpoint: `https://api.bilibili.com/x/web-interface/view?bvid={id}`
///
/// Provides basic video information including title and available parts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<WebInterfaceApiResponseData>,
}

/// Represents a single page/part of a video.
///
/// Multi-part videos (e.g., episodic content) contain multiple pages,
/// each with its own content ID and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponsePage {
    /// Content ID for this specific video part
    pub cid: i64,
    /// Page number (1-indexed)
    pub page: i32,
    /// Part title (e.g., "第1话", "Part 1")
    pub part: String,
    /// Duration in seconds
    pub duration: i64,
    /// URL to the first frame thumbnail image
    pub first_frame: String,
}

/// Video metadata from the web interface view API.
///
/// Contains title, thumbnail, and page information for a video.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponseData {
    /// Video title
    pub title: String,
    /// Cover image URL
    pub pic: String,
    /// Default content ID (for single-part videos)
    pub cid: i64,
    /// List of video parts/pages
    pub pages: Vec<WebInterfaceApiResponsePage>,
}

/// Response structure from the Bilibili player API.
///
/// API endpoint: `https://api.bilibili.com/x/player/wbi/playurl?...`
///
/// Provides detailed playback information including available video and audio
/// streams with quality options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<XPlayerApiResponseData>,
}

/// Player API response data containing DASH stream information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseData {
    pub dash: XPlayerApiResponseDash,
}

/// DASH (Dynamic Adaptive Streaming over HTTP) stream data.
///
/// Contains separate lists for video and audio streams, allowing
/// flexible quality selection and parallel downloading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseDash {
    /// Available video stream qualities
    pub video: Vec<XPlayerApiResponseVideo>,
    /// Available audio stream qualities
    pub audio: Vec<XPlayerApiResponseVideo>,
}

/// Individual video or audio stream representation.
///
/// Contains quality information, codec details, and the direct download URL
/// for a specific stream quality level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseVideo {
    /// Quality ID (e.g., 116=4K, 80=1080P, 64=720P)
    pub id: i32,
    /// Codec ID (e.g., 7=AVC, 12=HEVC)
    pub codecid: i16,
    /// Bandwidth in bits per second
    pub bandwidth: i64,
    /// Video width in pixels
    pub width: i16,
    /// Video height in pixels
    pub height: i16,
    /// Direct download URL for this stream
    #[serde(rename = "baseUrl")]
    pub base_url: String,
}
