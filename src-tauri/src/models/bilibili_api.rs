//! Bilibili API Response Models

use serde::{Deserialize, Serialize};

/// User navigation API response.
///
/// Endpoint: `https://api.bilibili.com/x/web-interface/nav`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponse {
    pub code: i32,
    pub message: String,
    pub ttl: u32,
    pub data: UserApiResponseData,
}

/// User data including authentication and WBI image info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponseData {
    pub uname: Option<String>,
    #[serde(rename = "isLogin")]
    pub is_login: bool,
    pub wbi_img: UserApiResponseDataImg,
}

/// WBI image URLs for request signing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponseDataImg {
    pub img_url: String,
    pub sub_url: String,
}

/// Web interface view API response.
///
/// Endpoint: `https://api.bilibili.com/x/web-interface/view?bvid={id}`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<WebInterfaceApiResponseData>,
}

/// Single page/part of a multi-part video.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponsePage {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
    #[serde(default)]
    pub first_frame: Option<String>,
}

/// Video metadata from the web interface view API.
///
/// # Note
///
/// The `pages` field may be absent for some videos.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponseData {
    pub title: String,
    pub pic: String,
    pub cid: i64,
    #[serde(default)]
    pub pages: Option<Vec<WebInterfaceApiResponsePage>>,
}

/// Player API response for DASH streams.
///
/// Endpoint: `https://api.bilibili.com/x/player/wbi/playurl`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<XPlayerApiResponseData>,
}

/// DASH stream data from player API response.
///
/// Contains the actual video and audio streams available for download.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseData {
    pub dash: XPlayerApiResponseDash,
}

/// DASH video and audio streams container.
///
/// Holds separate lists for video and audio streams, allowing the client
/// to select and download the highest quality for each type independently.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseDash {
    /// Available video stream qualities
    pub video: Vec<XPlayerApiResponseVideo>,
    /// Available audio stream qualities
    pub audio: Vec<XPlayerApiResponseVideo>,
}

/// Individual video or audio stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseVideo {
    pub id: i32,
    pub codecid: i16,
    pub bandwidth: i64,
    pub width: i16,
    pub height: i16,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
}
