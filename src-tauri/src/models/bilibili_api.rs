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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserApiResponseData {
    pub uname: Option<String>,
    #[serde(rename = "isLogin")]
    pub is_login: bool,
    pub wbi_img: UserApiResponseDataImg,
}

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
    pub data: WebInterfaceApiResponseData,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponsePage {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
    pub first_frame: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponseData {
    pub title: String,
    pub cid: i64,
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
    pub data: XPlayerApiResponseData,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseData {
    pub dash: XPlayerApiResponseDash,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseDash {
    pub video: Vec<XPlayerApiResponseVideo>,
    pub audio: Vec<XPlayerApiResponseVideo>,
}
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
