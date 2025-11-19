use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub code: i32,
    pub message: String,
    pub data: UserData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    pub uname: Option<String>,
    #[serde(rename = "isLogin")]
    pub is_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Video {
    pub title: String,
    pub bvid: String,
    pub parts: Vec<VideoPart>,
}
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thumbnail {
    pub url: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quality {
    pub id: i32,
    pub codecid: i16,
}
