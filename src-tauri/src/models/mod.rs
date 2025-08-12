use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CookieEntry {
    pub host: String,
    pub name: String,
    pub value: String,
}

#[derive(Default)]
pub struct CookieCache {
    pub cookies: Mutex<Vec<CookieEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub code: i32,
    pub message: String,
    pub ttl: u32,
    pub data: UserData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    pub uname: Option<String>,
    #[serde(rename = "isLogin")]
    pub is_login: bool,
    pub wbi_img: UserDataImg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserDataImg {
    pub img_url: String,
    pub sub_url: String,
}
