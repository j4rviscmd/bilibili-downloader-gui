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
    /// Unparsed top-level DASH fields (e.g. `dolby`, `flac`) captured for
    /// diagnostic logging only. These VIP-only audio objects are
    /// intentionally NOT fed into stream selection (see issue #467
    /// investigation), but recording their presence helps confirm whether
    /// the manifest included them for a given account.
    #[serde(flatten, default)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
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
    /// AI subtitle type: 0 = legacy AI subtitle, 1 = translated AI subtitle.
    /// Absent for manually created subtitles.
    #[serde(default)]
    pub ai_type: Option<u8>,
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

#[cfg(test)]
mod tests {
    use super::*;

    // Why: fixture payloads are shaped after the response examples in
    // references/bilibili-API-collect/docs/ (video/info.md,
    // video/videostream_url.md, bangumi/videostream_url.md) with identifiers
    // and URL paths replaced by synthetic values, so parsing is exercised
    // against realistic full-response breadth rather than minimal objects.
    // Note: unmapped fields (rights, owner, stat, dolby, ...) are kept on
    // purpose — do not trim fixtures to mapped fields only. Files must also
    // stay strict JSON (no comments): serde_json parses the include_str!
    // output directly.
    const WEB_INTERFACE_VIEW: &str = include_str!("../../tests/fixtures/web_interface_view.json");
    const XPLAYER_PLAYURL: &str = include_str!("../../tests/fixtures/xplayer_playurl.json");
    const BANGUMI_PLAYER: &str = include_str!("../../tests/fixtures/bangumi_player.json");

    #[test]
    fn parses_web_interface_view_fixture() {
        let resp: WebInterfaceApiResponse = serde_json::from_str(WEB_INTERFACE_VIEW).unwrap();
        assert_eq!(resp.code, 0);

        let data = resp.data.expect("data present");
        assert_eq!(data.title, "【BW2019】自营 CUT");
        assert_eq!(data.cid, 146224527);
        assert!(data.redirect_url.is_none(), "no redirect in fixture");

        let pages = data.pages.expect("pages present");
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].cid, 146224527);
        assert_eq!(pages[0].page, 1);
        assert_eq!(pages[0].part, "1");
        assert_eq!(pages[0].duration, 265);
        assert!(
            pages[0].first_frame.is_none(),
            "first_frame absent on page 1"
        );
        assert_eq!(
            pages[1].first_frame.as_deref(),
            Some("http://i0.hdslb.com/bfs/story-fn/first-frame.jpg")
        );
    }

    #[test]
    fn web_interface_view_defaults_missing_optionals() {
        // Minimal payload: pages/redirect_url omitted (serde defaults),
        // unknown fields ignored.
        let resp: WebInterfaceApiResponse = serde_json::from_str(
            r#"{
                "code": -404,
                "message": "啥都木有",
                "ttl": 1,
                "data": {
                    "title": "t", "pic": "p", "cid": 1,
                    "bvid": "BV1xx", "aid": 2, "unknown_future_field": true
                }
            }"#,
        )
        .unwrap();

        assert_eq!(resp.code, -404);
        let data = resp.data.unwrap();
        assert!(data.pages.is_none());
        assert!(data.redirect_url.is_none());
    }

    #[test]
    fn web_interface_view_data_absent_yields_none() {
        // Error responses carry no data field at all.
        let resp: WebInterfaceApiResponse =
            serde_json::from_str(r#"{"code": 62002, "message": "稿件不可见"}"#).unwrap();
        assert_eq!(resp.code, 62002);
        assert!(resp.data.is_none());
    }

    #[test]
    fn parses_xplayer_playurl_dash_fixture() {
        let resp: XPlayerApiResponse = serde_json::from_str(XPLAYER_PLAYURL).unwrap();
        assert_eq!(resp.code, 0);

        let data = resp.data.expect("data present");
        assert_eq!(data.quality, Some(80));

        let dash = data.dash.expect("dash present");
        assert_eq!(dash.video.len(), 2);
        assert_eq!(dash.audio.len(), 2);

        let v127 = &dash.video[0];
        assert_eq!(v127.id, 127);
        assert_eq!(v127.codecid, 12);
        assert_eq!(v127.bandwidth, 4317613);
        assert_eq!(v127.width, 1920);
        assert_eq!(v127.height, 1080);
        assert!(v127.base_url.contains("example127.m4s"), "baseUrl rename");
        assert_eq!(
            v127.backup_urls.as_deref().map(|u| u.len()),
            Some(2),
            "backupUrl rename"
        );

        // VIP-only objects are captured via flatten for diagnostics, never
        // fed into stream selection (see issue #467 investigation).
        assert!(dash.extra.contains_key("dolby"));
        assert!(dash.extra.contains_key("flac"));

        let formats = data.support_formats.expect("support_formats present");
        assert_eq!(formats.len(), 3);
        assert_eq!(formats[0].quality, 16);
        assert_eq!(formats[2].display_desc, "1080P 高清");
    }

    #[test]
    fn parses_xplayer_durl_only_variant() {
        // Older (non-DASH) videos: dash absent, durl present instead.
        let resp: XPlayerApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "quality": 32,
                    "durl": [
                        {
                            "order": 1, "length": 205000, "size": 12345678,
                            "url": "https://example.com/seg.mp4",
                            "backup_url": ["https://example.com/seg_bak.mp4"]
                        }
                    ]
                }
            }"#,
        )
        .unwrap();

        let data = resp.data.unwrap();
        assert!(data.dash.is_none());
        let durl = data.durl.expect("durl present");
        assert_eq!(durl.len(), 1);
        assert_eq!(durl[0].order, 1);
        assert_eq!(durl[0].size, 12345678);
        assert_eq!(durl[0].url, "https://example.com/seg.mp4");
        assert_eq!(durl[0].backup_url.as_deref().map(|u| u.len()), Some(1));
    }

    #[test]
    fn parses_bangumi_player_fixture() {
        let resp: BangumiPlayerApiResponse = serde_json::from_str(BANGUMI_PLAYER).unwrap();
        assert_eq!(resp.code, 0);

        let result = resp.result.expect("result present");
        assert_eq!(result.quality, Some(64));
        assert_eq!(result.timelength, Some(1432000));
        assert_eq!(result.is_preview, Some(0));

        // DASH and durl coexist in this fixture; durls carries per-quality MP4.
        let dash = result.dash.expect("dash present");
        assert_eq!(dash.video.len(), 2);
        assert_eq!(dash.audio.len(), 1);
        assert_eq!(dash.audio[0].id, 30216);

        assert!(result.durl.as_deref().map(|d| d.len()) == Some(1));
        let durls = result.durls.expect("durls present");
        assert_eq!(durls.len(), 2);
        assert_eq!(durls[0].quality, 32);
        assert_eq!(durls[0].durl.len(), 1);

        let formats = result.support_formats.expect("support_formats");
        assert_eq!(formats[0].quality, 80);
        assert_eq!(formats[0].description, "1080P 高清");
    }

    #[test]
    fn parses_bangumi_season_and_episode_defaults() {
        let resp: BangumiSeasonApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "success",
                "result": {
                    "season_id": 28237, "title": "season", "cover": "c",
                    "episodes": [
                        {
                            "id": 3051843, "cid": 45776577, "aid": 74707191,
                            "cover": "ec", "badge": "",
                            "title": "1", "long_title": "Un cas"
                        }
                    ]
                }
            }"#,
        )
        .unwrap();

        let result = resp.result.unwrap();
        assert_eq!(result.season_id, 28237);
        // status/duration omitted -> serde defaults
        assert_eq!(result.episodes.len(), 1);
        let ep = &result.episodes[0];
        assert_eq!(ep.id, 3051843);
        assert_eq!(ep.cid, 45776577);
        assert_eq!(ep.aid, 74707191);
        assert_eq!(ep.long_title, "Un cas");
        assert_eq!(ep.status, 0);
        assert_eq!(ep.duration, 0);
    }

    #[test]
    fn parses_user_api_response_with_is_login_rename() {
        let resp: UserApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0", "ttl": 1,
                "data": {
                    "isLogin": true,
                    "mid": 10000,
                    "uname": "tester",
                    "wbi_img": { "img_url": "i", "sub_url": "s" }
                }
            }"#,
        )
        .unwrap();

        assert!(resp.data.is_login, "isLogin rename");
        assert_eq!(resp.data.mid, Some(10000));
        assert_eq!(resp.data.uname.as_deref(), Some("tester"));
        assert_eq!(resp.data.wbi_img.img_url, "i");
    }

    #[test]
    fn parses_user_api_response_logged_out() {
        // Logged-out nav: mid/uname are null, isLogin false.
        let resp: UserApiResponse = serde_json::from_str(
            r#"{
                "code": -101, "message": "账号未登录", "ttl": 1,
                "data": {
                    "isLogin": false, "mid": null, "uname": "",
                    "wbi_img": { "img_url": "i", "sub_url": "s" }
                }
            }"#,
        )
        .unwrap();
        assert!(!resp.data.is_login);
        assert!(resp.data.mid.is_none());
    }

    #[test]
    fn parses_favorite_folder_list_all() {
        // list-all returns the minimal subset; optional fields absent.
        let resp: FavoriteFolderListApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "count": 1,
                    "list": [
                        {
                            "id": 111, "fid": 111, "mid": 222, "attr": 0,
                            "title": "默认收藏夹", "media_count": 7
                        }
                    ]
                }
            }"#,
        )
        .unwrap();

        let data = resp.data.unwrap();
        assert_eq!(data.count, 1);
        let folder = &data.list.expect("list present")[0];
        assert_eq!(folder.id, 111);
        assert_eq!(folder.title, "默认收藏夹");
        assert_eq!(folder.media_count, 7);
        assert!(folder.cover.is_none());
        assert!(folder.upper.is_none());
        assert!(folder.fav_state.is_none());
    }

    #[test]
    fn parses_favorite_resource_list() {
        let resp: FavoriteResourceListApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "info": {
                        "id": 111, "fid": 111, "mid": 222, "attr": 0,
                        "title": "默认收藏夹", "cover": "c",
                        "upper": { "mid": 222, "name": "u", "face": "f" },
                        "cover_type": 0,
                        "cnt_info": { "collect": 0, "play": 0, "thumb_up": 0, "share": 0 },
                        "type": 0, "intro": "", "ctime": 1, "mtime": 2,
                        "state": 0, "fav_state": 0, "media_count": 1
                    },
                    "medias": [
                        {
                            "id": 1, "type": 2, "title": "v", "cover": "cv",
                            "intro": "", "page": 1, "duration": 60,
                            "upper": { "mid": 3, "name": "up", "face": "fc" },
                            "attr": 0,
                            "cnt_info": { "collect": 1, "play": 2, "danmaku": 3 },
                            "link": "https://www.bilibili.com/video/BV1xx",
                            "ctime": 1, "pubtime": 1, "fav_time": 1,
                            "bv_id": "BV1xx", "bvid": "BV1xx"
                        }
                    ],
                    "has_more": true
                }
            }"#,
        )
        .unwrap();

        let data = resp.data.unwrap();
        assert_eq!(data.info.id, 111);
        // "type" renames to folder_type in info, media_type in medias
        assert_eq!(data.info.folder_type, 0);
        assert!(data.has_more);
        let media = &data.medias.expect("medias")[0];
        assert_eq!(media.media_type, 2);
        assert_eq!(media.cnt_info.danmaku, 3);
        assert_eq!(media.bvid, "BV1xx");
    }

    #[test]
    fn parses_watch_history_with_defaults() {
        let resp: WatchHistoryApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "list": [
                        {
                            "title": "1", "cover": "c",
                            "history": { "bvid": "BV1h", "cid": 9, "page": 1 },
                            "view_at": 1700000000, "duration": 100,
                            "progress": -1
                        }
                    ],
                    "cursor": { "view_at": 1700000000, "max": 1700000000, "is_end": false }
                }
            }"#,
        )
        .unwrap();

        let data = resp.data.unwrap();
        assert_eq!(data.list.len(), 1);
        assert_eq!(data.list[0].history.bvid, "BV1h");
        assert_eq!(data.list[0].progress, -1);
        assert_eq!(data.cursor.max, 1700000000);
        assert!(!data.cursor.is_end);
    }

    #[test]
    fn watch_history_missing_optionals_default() {
        // progress/cid/page are serde defaults; absent history fields must
        // not fail the parse for legacy entries.
        let resp: WatchHistoryApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "list": [
                        {
                            "title": "t", "cover": "c",
                            "history": { "bvid": "BV1x" },
                            "view_at": 1, "duration": 2
                        }
                    ],
                    "cursor": { "view_at": 1, "max": 1 }
                }
            }"#,
        )
        .unwrap();

        let item = &resp.data.unwrap().list[0];
        assert_eq!(item.progress, 0);
        assert_eq!(item.history.cid, 0);
        assert_eq!(item.history.page, 0);
    }

    #[test]
    fn parses_player_v2_subtitles_with_ai_type() {
        let resp: PlayerV2ApiResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "subtitle": {
                        "subtitles": [
                            {
                                "lan": "zh-CN", "lan_doc": "中文（简体）",
                                "subtitle_url": "//aisubtitle.hdslb.com/bfs/ai_subtitle/1.bcc.json",
                                "ai_type": 0
                            },
                            {
                                "lan": "ai-zh", "lan_doc": "中文（自动生成）",
                                "subtitle_url": "//aisubtitle.hdslb.com/bfs/ai_subtitle/2.bcc.json",
                                "ai_status": 0
                            },
                            {
                                "lan": "en", "lan_doc": "English",
                                "subtitle_url": "//i0.hdslb.com/bfs/subtitle/3.bcc.json"
                            }
                        ]
                    }
                }
            }"#,
        )
        .unwrap();

        let subs = resp
            .data
            .and_then(|d| d.subtitle)
            .and_then(|s| s.subtitles)
            .expect("subtitles present");
        assert_eq!(subs.len(), 3);
        assert_eq!(subs[0].ai_type, Some(0));
        assert_eq!(subs[0].lan_doc, "中文（简体）");
        assert!(
            subs[1].ai_type.is_none(),
            "ai_status (different field) must not leak into ai_type"
        );
        assert!(subs[2].ai_type.is_none(), "manual subtitle has no ai_type");
    }

    #[test]
    fn bcc_subtitle_parses_manual_format() {
        let bcc: BccSubtitle = serde_json::from_str(
            r#"{
                "font_size": 0.4,
                "font_color": "0xFFFFFF",
                "background_alpha": 0.5,
                "background_color": "0x000000",
                "Stroke": "none",
                "type": "ai",
                "body": [
                    { "from": 0.0, "to": 2.5, "location": 0, "content": "こんにちは" },
                    { "from": 2.5, "to": 4.0, "content": "second line" }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(bcc.font_size, 0.4);
        assert_eq!(bcc.font_color, "0xFFFFFF");
        assert_eq!(bcc.background_alpha, 0.5);
        assert_eq!(bcc.stroke, "none", "Stroke capital-S rename");
        assert_eq!(bcc.body.len(), 2);
        assert_eq!(bcc.body[0].from, 0.0);
        assert_eq!(bcc.body[0].to, 2.5);
        assert_eq!(bcc.body[0].location, 0);
        assert_eq!(bcc.body[0].content, "こんにちは");
        assert_eq!(bcc.body[1].location, 0, "location serde default");
    }

    #[test]
    fn bcc_subtitle_applies_ai_defaults() {
        // AI subtitles omit styling fields — serde defaults must kick in.
        let bcc: BccSubtitle =
            serde_json::from_str(r#"{ "body": [ { "from": 1.0, "to": 2.0, "content": "ai" } ] }"#)
                .unwrap();

        assert_eq!(bcc.font_size, 0.0);
        assert_eq!(bcc.font_color, "0xFFFFFF");
        assert_eq!(bcc.background_alpha, 0.0);
        assert_eq!(bcc.background_color, "0x000000");
        assert_eq!(bcc.stroke, "");
    }

    #[test]
    fn xplayer_roundtrip_preserves_renames() {
        let resp: XPlayerApiResponse = serde_json::from_str(XPLAYER_PLAYURL).unwrap();
        let json = serde_json::to_value(&resp).unwrap();
        let reparsed: XPlayerApiResponse = serde_json::from_value(json.clone()).unwrap();

        let orig = resp.data.and_then(|d| d.dash).unwrap();
        let again = reparsed.data.and_then(|d| d.dash).unwrap();
        assert_eq!(orig.video.len(), again.video.len());
        assert_eq!(again.video[0].base_url, orig.video[0].base_url);
        // flatten'd extra survives the roundtrip as a map
        assert!(again.extra.contains_key("dolby"));
        // serialized form uses the API field names
        assert!(json["data"]["dash"]["video"][0].get("baseUrl").is_some());
    }
}
