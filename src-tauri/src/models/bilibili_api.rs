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

/// BCC (Bilibili Closed Caption) format subtitle data.
///
/// This struct represents Bilibili's native subtitle format, which is stored as JSON
/// and served via the subtitle_url field in the PlayerV2 API. It supports both
/// manually created subtitles and AI-generated subtitles.
///
/// # AI Subtitle Compatibility
///
/// AI-generated subtitles include additional fields not present in manual subtitles:
/// - `type`: Subtitle type (e.g., "ai")
/// - `lang`: Language code
/// - `version`: Format version
///
/// These extra fields are automatically ignored during deserialization via the
/// `#[serde(default)]` attributes on the struct fields. This design allows the same
/// struct to handle both subtitle formats without errors.
///
/// # Default Values
///
/// Default values are required for several fields because AI-generated subtitles
/// may omit styling-related fields that are always present in manual subtitles:
///
/// - `font_size`: Defaults to 0.0 (AI subtitles typically use the player's default)
/// - `font_color`: Defaults to "0xFFFFFF" (white text)
/// - `background_alpha`: Defaults to 0.0 (transparent background)
/// - `background_color`: Defaults to "0x000000" (black background)
/// - `stroke`: Defaults to empty string (no text stroke)
///
/// # Example
///
/// ```json
/// {
///   "font_size": 0.4,
///   "font_color": "0xFFFFFF",
///   "background_alpha": 0.5,
///   "background_color": "0x000000",
///   "Stroke": "none",
///   "body": [
///     {
///       "from": 0.0,
///       "to": 2.5,
///       "location": 0,
///       "content": "Example subtitle text"
///     }
///   ]
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BccSubtitle {
    /// Font size multiplier.
    ///
    /// In manual subtitles, this is typically 0.4. AI-generated subtitles may omit
    /// this field, in which case it defaults to 0.0 and the player uses its default
    /// font size setting.
    #[serde(default)]
    pub font_size: f32,

    /// Font color in hex format.
    ///
    /// Defaults to "0xFFFFFF" (white) for compatibility with AI subtitles that
    /// don't specify font color. Manual subtitles typically use this value.
    #[serde(default = "default_font_color")]
    pub font_color: String,

    /// Background transparency (alpha channel).
    ///
    /// Ranges from 0.0 (fully transparent) to 1.0 (fully opaque). Manual subtitles
    /// typically use 0.5 for semi-transparent backgrounds. AI subtitles often omit
    /// this field (defaults to 0.0).
    #[serde(default)]
    pub background_alpha: f32,

    /// Background color in hex format.
    ///
    /// Defaults to "0x000000" (black) for AI subtitle compatibility. Manual
    /// subtitles typically combine this with background_alpha to create a
    /// semi-transparent black background behind text.
    #[serde(default = "default_background_color")]
    pub background_color: String,

    /// Text stroke color.
    ///
    /// Typically "none" or an empty string, indicating no outline around the
    /// subtitle text. The field name uses capital "S" ("Stroke") to match
    /// Bilibili's JSON format exactly.
    #[serde(rename = "Stroke", default)]
    pub stroke: String,

    /// Collection of subtitle entries with timing and text.
    ///
    /// This is the only required field in the BCC format. Each entry contains
    /// the subtitle text with start/end timestamps for synchronization.
    pub body: Vec<BccSubtitleBody>,
}

// ============================================================================
// BCC Subtitle Defaults
// ============================================================================

/// Default font color for subtitles.
///
/// This constant provides the default hex color value for subtitle text when
/// the field is omitted from the subtitle JSON (as occurs with AI-generated
/// subtitles). White ("0xFFFFFF") is the standard color for Bilibili subtitles.
const DEFAULT_FONT_COLOR: &str = "0xFFFFFF";

/// Default background color for subtitles.
///
/// This constant provides the default hex color value for the subtitle
/// background when the field is omitted from the subtitle JSON (as occurs
/// with AI-generated subtitles). Black ("0x000000") is typically combined
/// with semi-transparency to create a readable background.
const DEFAULT_BACKGROUND_COLOR: &str = "0x000000";

/// Returns the default font color as a String.
///
/// This function is used by serde's `default` attribute to provide a fallback
/// value when deserializing subtitles that don't specify a font color.
///
/// # Returns
///
/// A String containing "0xFFFFFF" (white in hex format).
fn default_font_color() -> String {
    DEFAULT_FONT_COLOR.to_string()
}

/// Returns the default background color as a String.
///
/// This function is used by serde's `default` attribute to provide a fallback
/// value when deserializing subtitles that don't specify a background color.
///
/// # Returns
///
/// A String containing "0x000000" (black in hex format).
fn default_background_color() -> String {
    DEFAULT_BACKGROUND_COLOR.to_string()
}

/// Individual subtitle entry within the BCC format body.
///
/// Represents a single subtitle line with its timing information and text content.
/// Multiple `BccSubtitleBody` entries are collected in the `BccSubtitle.body` field
/// to form the complete subtitle track.
///
/// # Field Descriptions
///
/// - **from**: Start timestamp in seconds (e.g., 1.5 means the subtitle appears
///   at 1.5 seconds into the video)
/// - **to**: End timestamp in seconds (e.g., 4.0 means the subtitle disappears
///   at 4.0 seconds)
/// - **location**: Screen positioning code (0 = bottom center, the standard
///   position for most subtitles)
/// - **content**: The actual subtitle text to display, may include newlines for
///   multi-line subtitles
///
/// # Example
///
/// ```json
/// {
///   "from": 10.5,
///   "to": 14.2,
///   "location": 0,
///   "content": "This is a subtitle"
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BccSubtitleBody {
    /// Start timestamp in seconds.
    ///
    /// Indicates when this subtitle should appear on screen. The value is a
    /// floating-point number allowing sub-second precision (e.g., 10.5 represents
    /// 10 seconds and 500 milliseconds).
    pub from: f64,

    /// End timestamp in seconds.
    ///
    /// Indicates when this subtitle should disappear from screen. The subtitle
    /// is visible during the interval [from, to).
    pub to: f64,

    /// Screen position code.
    ///
    /// Determines where on screen the subtitle appears. A value of 0 represents
    /// the default position (bottom center). Other values may position the
    /// subtitle differently, though these are rarely used in practice.
    #[serde(default)]
    pub location: i32,

    /// Subtitle text content.
    ///
    /// The actual text to display. May contain newline characters for multi-line
    /// subtitles. The text encoding follows the JSON document's encoding (typically
    /// UTF-8).
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
