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
/// The `redirect_url` field is present when a video redirects to another page
/// (e.g., bangumi episode or festival page).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebInterfaceApiResponseData {
    pub title: String,
    pub pic: String,
    pub cid: i64,
    #[serde(default)]
    pub pages: Option<Vec<WebInterfaceApiResponsePage>>,
    /// Redirect URL for special content (e.g., bangumi episode)
    #[serde(default, rename = "redirect_url")]
    pub redirect_url: Option<String>,
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

/// Player API response data containing stream information.
///
/// Supports both DASH (adaptive streaming) and durl (direct URL) formats.
/// Modern videos use DASH; older videos may use durl format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPlayerApiResponseData {
    /// DASH stream data (absent for durl-format videos)
    #[serde(default)]
    pub dash: Option<XPlayerApiResponseDash>,
    /// Direct URL format segments (for non-DASH videos)
    #[serde(default)]
    pub durl: Option<Vec<DurlSegment>>,
    /// Supported quality formats with descriptions
    #[serde(default)]
    pub support_formats: Option<Vec<SupportFormat>>,
    /// Current video quality code
    #[serde(default)]
    pub quality: Option<i32>,
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

// ============================================================================
// Subtitle APIs
// ============================================================================

/// Player v2 API response for subtitle information.
///
/// Endpoint: `https://api.bilibili.com/x/player/wbi/v2?bvid={bvid}&cid={cid}`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerV2ApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<PlayerV2ApiData>,
}

/// Player v2 API data containing subtitle information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerV2ApiData {
    #[serde(default)]
    pub subtitle: Option<PlayerV2Subtitle>,
}

/// Subtitle container in player v2 API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerV2Subtitle {
    #[serde(default)]
    pub subtitles: Option<Vec<PlayerV2SubtitleItem>>,
}

/// Individual subtitle item with language and URL information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerV2SubtitleItem {
    /// Language code (e.g., "zh-CN", "en")
    pub lan: String,
    /// Language display text (e.g., "中文（简体）")
    #[serde(rename = "lan_doc")]
    pub lan_doc: String,
    /// Subtitle URL (BCC JSON format)
    pub subtitle_url: String,
}

/// BCC format subtitle data.
///
/// Bilibili's native subtitle format stored as JSON.
/// AI subtitles may have additional fields (type, lang, version) which are ignored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BccSubtitle {
    /// Font size (typically 0.4)
    #[serde(default)]
    pub font_size: f32,
    /// Font color (typically "0xFFFFFF")
    #[serde(default = "default_font_color")]
    pub font_color: String,
    /// Background alpha (typically 0.5)
    #[serde(default)]
    pub background_alpha: f32,
    /// Background color (typically "0x000000")
    #[serde(default = "default_background_color")]
    pub background_color: String,
    /// Stroke color (typically "none")
    #[serde(rename = "Stroke", default)]
    pub stroke: String,
    /// Subtitle body containing text entries
    pub body: Vec<BccSubtitleBody>,
}

fn default_font_color() -> String {
    "0xFFFFFF".to_string()
}

fn default_background_color() -> String {
    "0x000000".to_string()
}

/// Individual subtitle entry in BCC format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BccSubtitleBody {
    /// Start time in seconds
    pub from: f64,
    /// End time in seconds
    pub to: f64,
    /// Location code (0 = default position)
    #[serde(default)]
    pub location: i32,
    /// Subtitle text content
    pub content: String,
}

// ============================================================================
// Bangumi APIs
// ============================================================================

/// Bangumi season API response.
///
/// Endpoint: `https://api.bilibili.com/pgc/view/web/season?ep_id={ep_id}`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSeasonApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub result: Option<BangumiSeasonResult>,
}

/// Bangumi season data containing episodes and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSeasonResult {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    #[serde(default)]
    pub episodes: Vec<BangumiEpisode>,
}

/// Individual bangumi episode with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiEpisode {
    /// Episode ID (ep_id)
    pub id: i64,
    /// CID for video playback
    pub cid: i64,
    /// AID (av number)
    pub aid: i64,
    /// Episode title (short)
    #[serde(default)]
    pub title: String,
    /// Episode title (long/description)
    #[serde(default)]
    pub long_title: String,
    /// Episode cover image
    pub cover: String,
    /// Episode status (2=free, 13=VIP-only)
    #[serde(default)]
    pub status: i32,
    /// Duration in milliseconds
    #[serde(default)]
    pub duration: i64,
}

/// Bangumi player API response for DASH streams.
///
/// Endpoint: `https://api.bilibili.com/pgc/player/web/playurl`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiPlayerApiResponse {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub result: Option<BangumiPlayerResult>,
}

/// Bangumi player result containing DASH stream data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiPlayerResult {
    #[serde(default)]
    pub dash: Option<XPlayerApiResponseDash>,
    /// Direct URL format (MP4) - used when DASH is not available
    #[serde(default)]
    pub durl: Option<Vec<DurlSegment>>,
    /// Multiple quality direct URLs (MP4)
    #[serde(default)]
    pub durls: Option<Vec<DurlQualityEntry>>,
    /// Supported quality formats with descriptions
    #[serde(default)]
    pub support_formats: Option<Vec<SupportFormat>>,
    /// Video quality code
    #[serde(default)]
    pub quality: Option<i32>,
    /// Whether this is a preview (1 = preview only)
    #[serde(default)]
    pub is_preview: Option<i32>,
    /// Total video length in milliseconds
    #[serde(default)]
    pub timelength: Option<i64>,
}

/// Direct URL segment for non-DASH streams.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurlSegment {
    pub order: i32,
    pub length: i64,
    pub size: i64,
    pub url: String,
    #[serde(default)]
    pub backup_url: Option<Vec<String>>,
}

/// Quality entry containing durl segments for a specific quality.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurlQualityEntry {
    pub quality: i32,
    pub durl: Vec<DurlSegment>,
}

/// Supported format information for quality selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportFormat {
    pub quality: i32,
    pub format: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub new_description: String,
    #[serde(default)]
    pub display_desc: String,
}
