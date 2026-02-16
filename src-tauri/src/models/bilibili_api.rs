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
    pub mid: Option<i64>,
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
    /// Backup CDN URLs for fallback when primary URL is slow.
    #[serde(default, rename = "backupUrl")]
    pub backup_urls: Option<Vec<String>>,
}

// ============================================================================
// Favorite Folder APIs
// ============================================================================

/// Favorite folder list API response.
///
/// Endpoint: `https://api.bilibili.com/x/v3/fav/folder/created/list-all`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteFolderListApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<FavoriteFolderListData>,
}

/// Wrapper for the favorite folder list data.
///
/// The `list-all` API returns `{ "count": N, "list": [...] }`
/// inside the `data` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteFolderListData {
    pub count: i64,
    #[serde(default)]
    pub list: Option<Vec<FavoriteFolderApiResponseData>>,
}

/// Individual favorite folder data.
///
/// The `list-all` API returns a minimal subset of fields
/// (id, fid, mid, attr, title, fav_state, media_count).
/// Other fields are only present in the resource list API's `info`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteFolderApiResponseData {
    pub id: i64,
    pub fid: i64,
    pub mid: i64,
    pub attr: i32,
    pub title: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub upper: Option<FavoriteFolderUpper>,
    #[serde(default)]
    pub cover_type: Option<i32>,
    #[serde(default, rename = "cnt_info")]
    pub cnt_info: Option<FavoriteFolderCntInfo>,
    #[serde(default, rename = "type")]
    pub folder_type: Option<i32>,
    #[serde(default)]
    pub intro: Option<String>,
    #[serde(default)]
    pub ctime: Option<i64>,
    #[serde(default)]
    pub mtime: Option<i64>,
    #[serde(default)]
    pub state: Option<i32>,
    #[serde(default)]
    pub fav_state: Option<i32>,
    pub media_count: i64,
}

/// Upper (creator) information for favorite folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteFolderUpper {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// Content count information for favorite folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteFolderCntInfo {
    pub collect: i64,
    pub play: i64,
    pub thumb_up: i64,
    pub share: i64,
}

// ============================================================================
// Favorite Resource (Video) APIs
// ============================================================================

/// Favorite resource list API response.
///
/// Endpoint: `https://api.bilibili.com/x/v3/fav/resource/list`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteResourceListApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<FavoriteResourceListApiResponseData>,
}

/// Favorite resource list data with pagination info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteResourceListApiResponseData {
    pub info: FavoriteResourceInfo,
    pub medias: Option<Vec<FavoriteResourceMedia>>,
    pub has_more: bool,
}

/// Favorite folder info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteResourceInfo {
    pub id: i64,
    pub fid: i64,
    pub mid: i64,
    pub attr: i32,
    pub title: String,
    pub cover: String,
    pub upper: FavoriteFolderUpper,
    pub cover_type: i32,
    #[serde(rename = "cnt_info")]
    pub cnt_info: FavoriteFolderCntInfo,
    #[serde(rename = "type")]
    pub folder_type: i32,
    pub intro: String,
    pub ctime: i64,
    pub mtime: i64,
    pub state: i32,
    pub fav_state: i32,
    pub media_count: i64,
}

/// Individual media (video) in favorite folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteResourceMedia {
    pub id: i64,
    #[serde(rename = "type")]
    pub media_type: i32,
    pub title: String,
    pub cover: String,
    pub intro: String,
    pub page: i32,
    pub duration: i64,
    pub upper: FavoriteMediaUpper,
    pub attr: i32,
    pub cnt_info: FavoriteMediaCntInfo,
    pub link: String,
    pub ctime: i64,
    pub pubtime: i64,
    pub fav_time: i64,
    pub bv_id: String,
    pub bvid: String,
}

/// Upper (uploader) information for media.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteMediaUpper {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// Content count information for media.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteMediaCntInfo {
    pub collect: i64,
    pub play: i64,
    pub danmaku: i64,
}

// ============================================================================
// Watch History APIs
// ============================================================================

/// Watch history API response from Bilibili.
///
/// Endpoint: `https://api.bilibili.com/x/web-interface/history/cursor`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryApiResponse {
    pub code: i64,
    pub message: String,
    pub data: Option<WatchHistoryApiResponseData>,
}

/// Watch history data containing list of viewed videos and pagination cursor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryApiResponseData {
    pub list: Vec<WatchHistoryApiItem>,
    pub cursor: WatchHistoryCursor,
}

/// Individual watch history entry from API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryApiItem {
    pub title: String,
    pub cover: String,
    pub history: WatchHistoryApiItemHistory,
    pub view_at: i64,
    pub duration: i64,
    #[serde(default)]
    pub progress: i64,
}

/// History details within a watch history item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryApiItemHistory {
    pub bvid: String,
    #[serde(default)]
    pub cid: i64,
    #[serde(default)]
    pub page: i32,
}

/// Pagination cursor for watch history API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchHistoryCursor {
    pub view_at: i64,
    pub max: i64,
    #[serde(default)]
    pub is_end: bool,
}
