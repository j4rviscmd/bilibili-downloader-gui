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
    pub cid: i64,
    #[serde(rename = "qualities")]
    pub video_qualities: Vec<Quality>,
    pub audio_qualities: Vec<Quality>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quality {
    pub id: i32,
    pub codecid: i16,
}
