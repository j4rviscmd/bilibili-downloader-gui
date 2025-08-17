use serde::{Deserialize, Serialize};

// User APIレスポンス
// https://api.bilibili.com/x/web-interface/nav
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

// WebInterface APIレスポンス
// https://api.bilibili.com/x/web-interface/view?bvid={id}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponse {
    pub code: i64,
    pub message: String,
    pub data: WebInterfaceApiResponseData,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponseData {
    pub title: String,
    pub cid: i64,
}

// WebInterface APIレスポンス
// https://api.bilibili.com/x/player/wbi/playurl?...
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
