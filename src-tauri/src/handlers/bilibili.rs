//! Bilibili API integration module.
//!
//! This module handles all interactions with the Bilibili API for video downloads,
//! user authentication, and metadata retrieval.
//!
//! ## Main Features
//!
//! - **Video Info Fetching**: Retrieves video metadata including titles, quality options, and thumbnails
//! - **User Authentication**: Fetches user information using cached cookies from Firefox
//! - **Video Downloading**: Downloads parallel audio/video streams merged with ffmpeg
//! - **Bangumi Support**: Handles anime/series episodes with VIP and preview restrictions
//! - **Short URL Expansion**: Resolves b23.tv short URLs to full bilibili.com URLs
//!
//! ## Architecture
//!
//! The module is organized into several key areas:
//!
//! - **Data Structures**: DTOs for API requests/responses (`SubtitleOptions`, `DownloadOptions`, etc.)
//! - **Video Metadata**: Functions for fetching video/bangumi information
//! - **Download Logic**: Main `download_video` function with quality selection and fallback
//! - **Utility Functions**: Cookie handling, quality conversion, history management
//!
//! ## Error Codes
//!
//! All errors are returned as `String` with standardized error code prefixes:
//! - `ERR::VIDEO_NOT_FOUND` - Video does not exist or is inaccessible
//! - `ERR::COOKIE_MISSING` - No cookies available for authenticated requests
//! - `ERR::QUALITY_NOT_FOUND` - Requested quality not available
//! - `ERR::DISK_FULL` - Insufficient disk space
//! - `ERR::NETWORK` - Network-related download failures
//! - `ERR::MERGE_FAILED` - ffmpeg merge operation failed
//! - `ERR::CANCELLED` - Download was cancelled by user
//! - `ERR::RATE_LIMITED` - HTTP 429 rate limit exceeded
//! - `ERR::API_ERROR` - Generic API request failure
//! - `ERR::BANGUMI_*` - Bangumi-specific errors (VIP only, region restricted, etc.)

use crate::utils::codec::{select_video_stream, VideoStreamSelection, CODECID_AVC};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Subtitle configuration options for video downloads.
///
/// Specifies how subtitles should be embedded into the output file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOptions {
    /// Subtitle embedding mode: "off" (no subtitles), "soft" (soft-sub), or "hard" (burned-in)
    pub mode: String,
    /// Selected subtitle language codes (e.g., "zh-CN", "en")
    #[serde(default)]
    pub selected_lans: Vec<String>,
    /// Complete subtitle information for selected languages (passed from frontend to avoid re-fetch)
    #[serde(default)]
    pub subtitles: Vec<SubtitleInfo>,
}

/// Subtitle information passed from frontend.
///
/// Contains all data needed to download and process a subtitle.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleInfo {
    /// Language code (e.g., "zh-CN", "en")
    pub lan: String,
    /// Language display text (e.g., "中文（简体）")
    pub lan_doc: String,
    /// Subtitle URL (BCC JSON format)
    pub subtitle_url: String,
    /// Whether this is an AI-generated subtitle
    pub is_ai: bool,
}

/// Payload for quality resolved event.
///
/// Sent to frontend after video/audio quality selection to display
/// the actual resolved quality (which may differ from user selection
/// due to fallback).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityResolvedPayload {
    /// Download ID for matching with frontend state
    pub download_id: String,
    /// Page number (1-indexed)
    pub page: i32,
    /// Resolved video quality ID
    pub video_quality: i32,
    /// Whether video quality was fallen back from user selection
    pub video_quality_fallback: bool,
    /// Resolved video codec ID
    pub video_codecid: i16,
    /// Whether video codec was fallen back from user selection
    pub video_codec_fallback: bool,
    /// Resolved audio quality ID (null for durl format or silent sources)
    pub audio_quality: Option<i32>,
    /// Whether audio quality was fallen back from user selection
    pub audio_quality_fallback: bool,
    /// True when the source has no audio track at all (issue #446) —
    /// distinguishes silent DASH downloads from durl (audio embedded)
    pub audio_absent: bool,
    /// Whether this is a preview (only first 6 minutes available)
    pub is_preview: Option<bool>,
}

/// Payload for subtitle resolved event.
///
/// Sent to frontend after subtitle processing to display
/// the resolved subtitle mode and language labels.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleResolvedPayload {
    /// Download ID for matching with frontend state
    pub download_id: String,
    /// Page number (1-indexed)
    pub page: i32,
    /// Subtitle mode: "off", "soft", or "hard"
    pub subtitle_mode: String,
    /// Language labels from Bilibili (e.g., "Español", "日本語")
    pub subtitle_language_labels: Vec<String>,
}

/// Download options for a video part.
///
/// Groups all parameters required for downloading a video part,
/// preventing function parameter bloat.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    /// Bilibili video ID (BV identifier, e.g., "BV1xx411c7XD")
    pub bvid: String,
    /// Content ID for the specific video part
    pub cid: i64,
    /// Output filename (extension optional; .mp4 added if missing)
    pub filename: String,
    /// Video quality ID. `None` means "best available" (auto-selects highest
    /// quality). Falls back to highest quality when the specified ID is
    /// unavailable.
    pub quality: Option<i32>,
    /// Audio quality ID (optional for durl format where audio is embedded)
    pub audio_quality: Option<i32>,
    /// Unique identifier for tracking this download
    pub download_id: String,
    /// Parent download ID for multi-part videos (optional)
    pub parent_id: Option<String>,
    /// Video duration in seconds for accurate merge progress display
    pub duration_seconds: i64,
    /// Thumbnail URL for this part (optional, used for history entry)
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    /// Page number for multi-part videos (optional)
    #[serde(default)]
    pub page: Option<i32>,
    /// Subtitle configuration options (optional)
    #[serde(default)]
    pub subtitle: Option<SubtitleOptions>,
    /// Episode ID for bangumi content (optional)
    #[serde(default)]
    pub ep_id: Option<i64>,
}

use crate::constants::{API_BASE, PLAYURL_FNVAL, PLAYURL_QN, REFERER};
use crate::handlers::cookie::read_cookie;
use crate::handlers::history_session::HistorySession;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    BangumiPlayerApiResponse, BangumiPlayerResult, BangumiSeasonApiResponse, PlayerV2ApiResponse,
    PopularApiResponse, SearchApiData, SearchApiResponse, SuggestApiResponse, UserApiResponse,
    WatchHistoryApiResponse, WebInterfaceApiResponse, WebInterfaceApiResponseData,
    XPlayerApiResponse, XPlayerApiResponseData, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{
    DownloadRetrying, Quality, SubtitleDto, Thumbnail, UserData, Video, VideoPart,
    WatchHistoryCursor, WatchHistoryEntry,
};
pub use crate::models::frontend_dto::{SearchFilters, SearchResponse, SearchResultEntry};
use crate::models::settings::Settings;
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::header;
use reqwest::Client;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Builds a reqwest HTTP client with the default user agent.
///
/// Creates a new HTTP client configured with the application's user agent
/// for making requests to Bilibili's API. The client is configured with
/// connection pooling and keep-alive for efficient repeated requests.
///
/// # Returns
///
/// Returns the configured HTTP client on success.
///
/// # Errors
///
/// Returns an error if the client builder fails to create the client.
///
/// # Example
///
/// Why: the example sends a live HTTP request; doctests now run in CI (rust-test job),
/// so it must not execute
/// ```ignore
/// let client = build_client()?;
/// let response = client.get("https://api.bilibili.com/...").send().await?;
/// ```
pub fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))
}

/// Bilibili web-API transport: client + base URL + cookie header.
///
/// Why: every fetcher previously hardcoded `https://api.bilibili.com` and
/// called `build_client()` inline, leaving the transport untestable. All
/// GET fetchers now route through this struct so wiremock tests can point
/// `base` at a local server. Error strings from the transport are the
/// unified `"BiliApi request failed: ..."` form (non-`ERR::` freeform
/// messages; only `ERR::` codes are mapped by the frontend).
#[derive(Clone)]
pub(crate) struct BiliApi {
    http: Client,
    /// API origin, e.g. "https://api.bilibili.com" (wiremock URL in tests)
    base: String,
    /// Pre-built Cookie header value; empty when logged out
    cookie_header: String,
}

/// Resolves the BiliApi origin: E2E runs may override it via the
/// E2E_API_BASE env var (localhost fixture server); every other case —
/// including E2E runs without the override — keeps the production base.
///
/// Pure (inputs in, base out) so the override matrix is unit-testable
/// without mutating process-global env from parallel tests.
fn api_base_with_e2e_override(e2e_testing: bool, env_base: Option<String>) -> String {
    match (e2e_testing, env_base) {
        (true, Some(base)) => base,
        _ => API_BASE.to_string(),
    }
}

impl BiliApi {
    /// Test constructor: explicit transport parts, no AppHandle needed.
    pub(crate) fn new(
        http: Client,
        base: impl Into<String>,
        cookie_header: impl Into<String>,
    ) -> Self {
        Self {
            http,
            base: base.into(),
            cookie_header: cookie_header.into(),
        }
    }

    /// Production constructor from a pre-built Cookie header value.
    pub(crate) fn from_cookie_header(cookie_header: impl Into<String>) -> Result<Self, String> {
        // E2E only: redirect every BiliApi hop (nav mixin key, playurl,
        // qualities) at the localhost fixture server started by wdio.conf.ts.
        // Gated on E2E_TESTING so production behavior is byte-identical.
        let base = api_base_with_e2e_override(
            crate::handlers::qr_login::is_e2e_testing(),
            std::env::var("E2E_API_BASE").ok(),
        );
        Ok(Self::new(build_client()?, base, cookie_header))
    }

    /// Same transport (client + origin) with a different Cookie header.
    ///
    /// Used by callers that hit several endpoints in one flow and need to
    /// switch authentication per request (e.g. QR login verifies the fresh
    /// session against nav while polling stays anonymous).
    pub(crate) fn with_cookie(&self, cookie_header: impl Into<String>) -> Self {
        Self {
            http: self.http.clone(),
            base: self.base.clone(),
            cookie_header: cookie_header.into(),
        }
    }

    /// Same client + cookie with a different API origin.
    ///
    /// QR login endpoints live on passport.bilibili.com while everything
    /// else rides api.bilibili.com; callers share one HTTP client across
    /// both (see handlers/qr_login.rs).
    pub(crate) fn with_base(&self, base: impl Into<String>) -> Self {
        Self {
            http: self.http.clone(),
            base: base.into(),
            cookie_header: self.cookie_header.clone(),
        }
    }

    /// Production constructor from raw cookie entries.
    fn from_cookies(cookies: &[CookieEntry]) -> Result<Self, String> {
        Self::from_cookie_header(build_cookie_header(cookies))
    }

    /// GET `{base}{path}` with Cookie/Referer headers, returning the
    /// status-checked response so callers keep their own parse/validate
    /// semantics (json vs text, ERR:: code mapping variants).
    pub(crate) async fn get(&self, path: &str) -> Result<reqwest::Response, String> {
        self.get_q(path, &[]).await
    }

    // Why: WBI-signed query values can contain reserved characters (`&`, spaces;
    // see w_rid in bili_api_get_q_encodes_query_pairs). reqwest's query encoder
    // percent-encodes them, while format!-embedding them into the path would send
    // raw bytes and break server-side parsing of the signed parameters.
    /// GET variant with reqwest-encoded query pairs (WBI-signed requests).
    pub(crate) async fn get_q(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<reqwest::Response, String> {
        let mut req = self
            .http
            .get(format!("{}{}", self.base, path))
            .header(header::REFERER, REFERER);
        if !self.cookie_header.is_empty() {
            req = req.header(header::COOKIE, &self.cookie_header);
        }
        let response = req
            .query(query)
            .send()
            .await
            .map_err(|e| format!("BiliApi request failed: {e}"))?;
        check_http_status(response.status())?;
        Ok(response)
    }

    /// POST `{base}{path}` as an urlencoded form with Cookie/Referer headers.
    ///
    /// Serves the passport cookie-refresh endpoints used by QR login
    /// (handlers/qr_login.rs), which take form bodies instead of queries.
    /// Callers that need a different Cookie per hop (e.g. confirming a
    /// refresh with the freshly issued cookies) chain [`with_cookie`]
    /// before this.
    pub(crate) async fn post_form(
        &self,
        path: &str,
        form: &[(&str, String)],
    ) -> Result<reqwest::Response, String> {
        let mut req = self
            .http
            .post(format!("{}{}", self.base, path))
            .header(header::REFERER, REFERER);
        if !self.cookie_header.is_empty() {
            req = req.header(header::COOKIE, &self.cookie_header);
        }
        let response = req
            .form(form)
            .send()
            .await
            .map_err(|e| format!("BiliApi request failed: {e}"))?;
        check_http_status(response.status())?;
        Ok(response)
    }
}

/// Validates Bilibili API response and returns appropriate error codes.
///
/// Checks API response code and data presence, returning standardized error codes.
/// Used by all API calls for consistent error handling.
///
/// # Arguments
///
/// * `code` - API response code (0 indicates success)
/// * `data` - Optional reference to response data
///
/// # Returns
///
/// Returns `Ok(())` on successful validation.
/// Returns `Err` with standardized error codes on failure:
/// - `ERR::UNAUTHORIZED` (-101) - Authentication required
/// - `ERR::VIDEO_NOT_FOUND` (-404) - Video not found
/// - `ERR::API_ERROR` - Other API errors
fn validate_api_response<T>(code: i64, data: Option<&T>) -> Result<(), String> {
    match code {
        -101 => Err("ERR::UNAUTHORIZED".into()),
        -404 => Err("ERR::VIDEO_NOT_FOUND".into()),
        0 if data.is_some() => Ok(()),
        _ => Err("ERR::API_ERROR".into()),
    }
}

/// Checks HTTP response status and returns appropriate error codes.
///
/// Validates HTTP status codes and returns standardized error codes.
/// Returns `Ok(())` for success range (200-299), otherwise returns error.
///
/// # Arguments
///
/// * `status` - HTTP status code to check
///
/// # Returns
///
/// Returns `Ok(())` if status is in success range (200-299).
/// Returns `Err` with error codes otherwise:
/// - `ERR::RATE_LIMITED` - HTTP 429 (rate limit exceeded)
/// - `ERR::API_ERROR` - Other errors
fn check_http_status(status: reqwest::StatusCode) -> Result<(), String> {
    match status.as_u16() {
        200..=299 => Ok(()),
        429 => Err("ERR::RATE_LIMITED".into()),
        _ => Err("ERR::API_ERROR".into()),
    }
}

/// Validates bangumi (anime/series) API responses and returns appropriate errors.
///
/// Converts bangumi-specific error codes to standardized format.
/// Handles bangumi-specific restrictions like region and copyright restrictions.
///
/// # Arguments
///
/// * `code` - API response code
/// * `message` - Error message (for logging)
///
/// # Returns
///
/// Returns `Ok(())` on successful validation (code=0).
/// Returns `Err` with bangumi-specific error codes on failure:
/// - `ERR::UNAUTHORIZED` (-101) - Authentication required
/// - `ERR::BANGUMI_NOT_FOUND` (-404) - Bangumi not found
/// - `ERR::BANGUMI_ACCESS_DENIED` (-403) - Access denied
/// - `ERR::BANGUMI_REGION_RESTRICTED` (-688) - Region restricted
/// - `ERR::BANGUMI_COPYRIGHT_RESTRICTED` (-689) - Copyright restricted
/// - `ERR::API_ERROR` - Other API errors
fn validate_bangumi_response(code: i64, message: &str) -> Result<(), String> {
    match code {
        -101 => Err("ERR::UNAUTHORIZED".into()),
        -404 => Err("ERR::BANGUMI_NOT_FOUND".into()),
        -403 => Err("ERR::BANGUMI_ACCESS_DENIED".into()),
        -688 => Err("ERR::BANGUMI_REGION_RESTRICTED".into()),
        -689 => Err("ERR::BANGUMI_COPYRIGHT_RESTRICTED".into()),
        0 => Ok(()),
        _ => Err(format!("ERR::API_ERROR (code {code}): {message}")),
    }
}

/// Extracts bangumi episode ID from a redirect URL.
///
/// Parses URLs like `https://www.bilibili.com/bangumi/play/ep3051843`
/// and returns the episode ID (3051843). This is used when short URLs
/// or player links redirect to bangumi episodes.
///
/// # Arguments
///
/// * `url` - The redirect URL to parse
///
/// # Returns
///
/// Returns `Some(ep_id)` if the URL matches the bangumi pattern, `None` otherwise.
///
/// # Example
///
/// Why: private fn; doctests compile as a separate crate and cannot import it, even
/// though the assertions themselves are pure (enforced by the rust-test CI job)
/// ```ignore
/// let url = "https://www.bilibili.com/bangumi/play/ep3051843";
/// assert_eq!(extract_bangumi_ep_id(url), Some(3051843));
/// ```
fn extract_bangumi_ep_id(url: &str) -> Option<i64> {
    url.split("/bangumi/play/ep").nth(1).and_then(|suffix| {
        suffix
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .ok()
    })
}

/// Downloads a bangumi episode using durl format (direct MP4 URL).
///
/// This download process is for bangumi content where DASH format is not available.
/// In durl format, audio is embedded in the video, so audio separation and ffmpeg merge are not needed.
///
/// # Processing Flow
///
/// 1. Register cancellation token
/// 2. Select requested quality or best quality entry
/// 3. Send quality resolution event to frontend
/// 4. Check disk space
/// 5. Direct download with retry logic
/// 6. Save download history (async)
/// 7. Remove cancellation token
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `options` - Download options (bvid, cid, quality, etc.)
/// * `output_path` - Output file path
/// * `cookie_header` - Cookie header for authentication
/// * `player_result` - Bangumi player API response
///
/// # Returns
///
/// Returns string representation of output file path on success.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - `ERR::BANGUMI_NO_DASH` - No durl data available
/// - `ERR::QUALITY_NOT_FOUND` - Requested quality not found
/// - `ERR::DISK_FULL` - Insufficient disk space
/// - `ERR::NETWORK` - Network error
/// - `ERR::CANCELLED` - Cancelled by user
#[allow(clippy::too_many_arguments)]
async fn download_bangumi_durl<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    options: &DownloadOptions,
    output_path: &Path,
    cookie_header: &str,
    api: &BiliApi,
    player_result: BangumiPlayerResult,
    host_health: Arc<crate::utils::cdn_selector::HostHealth>,
    segment_concurrency: usize,
) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // download_video already registered the cancellation token. Do NOT
    // re-register here (it would overwrite the existing token and lose an
    // in-flight cancel). Just check the pre-cancel flag; the
    // CancelTokenGuard held by download_video deregisters on every return
    // path from here (issue #561).
    if DOWNLOAD_CANCEL_REGISTRY.is_cancelled(&options.download_id) {
        return Err("ERR::CANCELLED".to_string());
    }

    // Extract is_preview info before moving player_result
    let is_preview = player_result.is_preview.map(|v| v == 1);

    // Get durls array
    let durls = player_result.durls.as_ref().ok_or("ERR::BANGUMI_NO_DASH")?;

    // Find quality entry (None means best available → -1 won't match any real
    // quality ID, so or_else falls through to the first/highest entry)
    let requested_quality = options.quality.unwrap_or(-1);
    let quality_entry = durls
        .iter()
        .find(|entry| entry.quality == requested_quality)
        .or_else(|| durls.first())
        .ok_or("ERR::QUALITY_NOT_FOUND")?;

    let durl_segment = quality_entry.durl.first().ok_or("ERR::QUALITY_NOT_FOUND")?;

    let video_url = &durl_segment.url;
    let backup_urls = durl_segment
        .backup_url
        .as_ref()
        .map(|urls| urls.iter().map(|s| s.to_string()).collect());

    // Emit quality resolved event to frontend
    let resolved_quality = quality_entry.quality;
    let page = options.page.unwrap_or(1);
    app.emit(
        "download-quality-resolved",
        QualityResolvedPayload {
            download_id: options.download_id.clone(),
            page,
            video_quality: resolved_quality,
            video_quality_fallback: options.quality.is_some()
                && options.quality != Some(resolved_quality),
            // Constraint: durl format delivers a single muxed stream — Bilibili
            // fixes the codec (AVC in practice) and exposes no codec choice, so
            // priority is irrelevant and fallback is always false (issue #460).
            video_codecid: CODECID_AVC,
            video_codec_fallback: false,
            audio_quality: None, // durl format has no separate audio
            audio_quality_fallback: false,
            audio_absent: false, // durl muxes the (existing) audio track in
            is_preview,
        },
    )
    .ok();

    // Capacity check
    if let Some(vs) = head_content_length(video_url, Some(cookie_header)).await {
        let total_needed = vs + (5 * 1024 * 1024); // 5MB buffer
        ensure_free_space(output_path, total_needed)?;
    }

    // Refetch inputs for attempt > 1 (bilibili signed URLs expire after 120 min).
    let bd_refetch_api = api.clone();
    let bd_refetch_bvid = options.bvid.clone();
    let bd_cid = options.cid;
    let bd_ep_id = options.ep_id;
    let bd_video_url = video_url.clone();
    let bd_backup_urls = backup_urls.clone();
    let bd_output_path = output_path.to_path_buf();
    let bd_cookie_header = cookie_header.to_string();
    let bd_download_id = options.download_id.clone();
    let bd_host_health = host_health.clone();
    // Download directly. Capture the result so success and error are handled
    // separately below (history save vs partial-file removal). Registry
    // cleanup is handled by download_video's CancelTokenGuard.
    let result = retry_download(
        app,
        &options.download_id,
        Some("video"),
        move |attempt: u8| {
            // Re-clone per call: async move consumes captured values, but
            // FnMut may invoke the closure up to MAX_ATTEMPTS times.
            let bd_api = bd_refetch_api.clone();
            let bvid = bd_refetch_bvid.clone();
            let video_url = bd_video_url.clone();
            let backup_urls = bd_backup_urls.clone();
            let output_path = bd_output_path.clone();
            let cookie_header = bd_cookie_header.clone();
            let download_id = bd_download_id.clone();
            let host_health = bd_host_health.clone();
            async move {
                let (url, backups) = if attempt == 1 {
                    (video_url.clone(), backup_urls.clone())
                } else {
                    log::info!(
                        "[BE] download_bangumi_durl: playurl refetch attempt={} for bangumi durl",
                        attempt
                    );
                    match refetch_durl_url(&bd_api, &bvid, bd_cid, bd_ep_id).await {
                        Ok(fresh) => fresh,
                        Err(e) => {
                            log::warn!(
                                "[BE] bangumi durl refetch failed, retrying with stale URL: {}",
                                e
                            );
                            (video_url.clone(), backup_urls.clone())
                        }
                    }
                };
                download_url(
                    app,
                    url,
                    backups,
                    output_path,
                    Some(cookie_header),
                    true,
                    Some(download_id),
                    Some("video"),
                    true,
                    segment_concurrency,
                    host_health.clone(),
                )
                .await
            }
        },
    )
    .await;

    // Registry cleanup (token removal + pre-cancel flag clear) is handled by
    // the CancelTokenGuard download_video holds for this download_id (issue
    // #561) — no explicit cleanup needed here on any return path.

    match result {
        Ok(()) => {
            // History recording is settled by download_video's HistorySession
            // from this return value (issue #511); no per-path save here.
            Ok(output_path.to_string_lossy().into_owned())
        }
        Err(e) => {
            // Remove partial output on failure/cancel to avoid leftover garbage.
            let _ = tokio::fs::remove_file(output_path).await;
            Err(e)
        }
    }
}

/// Downloads a Bilibili video with the specified quality settings.
///
/// This function orchestrates the entire download process:
/// 1. Output path determination with auto-rename handling
/// 2. Cookie presence validation
/// 3. Video details and stream URL fetching
/// 4. Pre-download disk space check
/// 5. Parallel audio/video stream download with retry logic
/// 6. Stream merging via ffmpeg (DASH) or direct save (durl)
///
/// Sends progress updates to the frontend throughout the process.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `options` - Download options including bvid, cid, quality, filename, etc.
///
/// # Returns
///
/// On success, returns the output file path as `String`.
///
/// # Errors
///
/// Returns an error if:
/// - Settings or output path cannot be obtained
/// - Cookies are missing (`ERR::COOKIE_MISSING`)
/// - Selected quality is unavailable (`ERR::QUALITY_NOT_FOUND`)
/// - Insufficient disk space (`ERR::DISK_FULL`)
/// - Download fails after retry attempts (`ERR::NETWORK`)
/// - ffmpeg merge fails (`ERR::MERGE_FAILED`)
/// - Download is cancelled (`ERR::CANCELLED`)
pub async fn download_video(app: &AppHandle, options: &DownloadOptions) -> Result<String, String> {
    // History lifecycle (issue #511): insert the in_progress entry before the
    // download body runs and settle it from the body's final Result, so every
    // exit path (early `?` returns included) is recorded with its real error
    // code. A pre-cancelled part settles as cancelled and removes the entry
    // again; a download killed mid-flight is caught by startup recovery.
    let session = HistorySession::start(app, options);
    let result = download_video_impl(app, options).await;
    session.settle(app, options, &result).await;
    result
}

/// Download body behind [`download_video`]; the wrapper owns the history
/// session so no early return inside can bypass the final settle.
///
/// This layer only resolves the app-coupled dependencies (settings, cookies,
/// output/lib paths, the real ffmpeg merge); the download flow itself lives in
/// [`download_video_impl_with`] so tests can drive it end-to-end with
/// wiremock + tempdir inputs (issue #646).
async fn download_video_impl(app: &AppHandle, options: &DownloadOptions) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // Codec priority is resolved once at download start and reused by every
    // refetch, so retries cannot switch codecs mid-download (previously each
    // refetch re-read the settings file).
    let settings = settings::get_settings(app).await.ok();
    let segment_concurrency = Settings::resolve_segment_concurrency(&settings);
    let codec_priority = settings
        .as_ref()
        .and_then(|s| s.video_codec_priority)
        .unwrap_or_default();

    // Pre-cancel guard mirrors the one inside `_with` but runs BEFORE the
    // app-coupled dependency resolution below: a download cancelled before
    // start must surface ERR::CANCELLED (and settle its history entry as
    // cancelled) even when cookies/output-path resolution would fail first.
    if DOWNLOAD_CANCEL_REGISTRY.is_cancelled(&options.download_id) {
        DOWNLOAD_CANCEL_REGISTRY.clear_cancelled(&options.download_id);
        return Err("ERR::CANCELLED".to_string());
    }

    // Get cookies (WBI signing enables non-logged-in usage)
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    // Single transport for the whole download (playurl fetch, refetches on
    // retry); threading it keeps every HTTP hop on one injectable seam.
    let api = BiliApi::from_cookie_header(cookie_header)?;

    let output_path = build_output_path(app, &options.filename).await?;
    let lib_path = get_lib_path(app);

    let download_id = options.download_id.clone();
    let duration_ms = (options.duration_seconds * 1000) as u64;
    download_video_impl_with(
        app,
        options,
        &api,
        &lib_path,
        &output_path,
        segment_concurrency,
        codec_priority,
        &move |video_path: &Path,
               audio_path: Option<&Path>,
               output_path: &Path,
               subtitle_mode,
               cancel_token| {
            // Own the handle/id per call: the returned future may only borrow
            // the path args (MergeFuture<'a>), so captured state must be moved
            // into the async block rather than borrowed from this closure.
            let app = app.clone();
            let download_id = download_id.clone();
            Box::pin(async move {
                crate::handlers::ffmpeg::merge_avs(
                    &app,
                    video_path,
                    audio_path,
                    output_path,
                    Some(download_id),
                    Some(duration_ms),
                    subtitle_mode,
                    Some(cancel_token),
                )
                .await
            })
        },
    )
    .await
}

/// Future returned by an injected merge fn. Boxed because the merge borrows
/// its path arguments across an await, which a named generic `Fut` param
/// cannot express (HRTB limitation); `Send` because Tauri command futures
/// must stay `Send`.
type MergeFuture<'a> =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>>;

/// Dependency-injected download flow (test seam, issue #646): runs the real
/// staging→download→subtitle→merge→finalize pipeline against explicit inputs
/// so E2E tests never touch the real-home settings store, lib dir, or ffmpeg
/// binary. `merge` stands in for `ffmpeg::merge_avs` (which needs the
/// concrete Wry handle and spawns the real binary).
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
// Why: generic over Runtime, not the default-Wry `&AppHandle`, because the E2E
// tests below pass `tauri::test::mock_app().handle()` (`AppHandle<MockRuntime>`,
// see the "test" dev-feature note in Cargo.toml), which only type-checks
// against a generic Runtime param (issue #646).
async fn download_video_impl_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    options: &DownloadOptions,
    api: &BiliApi,
    lib_path: &Path,
    output_path: &Path,
    segment_concurrency: usize,
    codec_priority: crate::utils::codec::VideoCodecPriority,
    merge: &(dyn for<'a> Fn(
        &'a Path,
        Option<&'a Path>,
        &'a Path,
        crate::handlers::ffmpeg::MergeMode,
        tokio_util::sync::CancellationToken,
    ) -> MergeFuture<'a>
          + Sync),
) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // The transport already carries the cookie header; read it once instead
    // of threading a duplicate parameter that could drift out of sync.
    let cookie_header = api.cookie_header.as_str();

    log::info!(
        "[BE] download_video: starting download id={}, bvid={}, cid={}",
        options.download_id,
        options.bvid,
        options.cid
    );

    // If this part was cancelled (via cancel_all_downloads) before
    // download_video started, reject immediately so it never runs. The flag
    // is cleared here because this runs BEFORE register() — no guard exists
    // yet to clear it on Drop.
    if DOWNLOAD_CANCEL_REGISTRY.is_cancelled(&options.download_id) {
        DOWNLOAD_CANCEL_REGISTRY.clear_cancelled(&options.download_id);
        return Err("ERR::CANCELLED".to_string());
    }

    // Register the cancellation token for this download. The returned guard
    // deregisters the token (remove + clear_cancelled) on EVERY exit path —
    // including the early `?` returns below that previously leaked it
    // (issue #561). Keep it alive until function return.
    // Note: the `_` prefix only silences the unused-variable warning; unlike a
    // bare `_` pattern, the binding lives to the end of the function, which is
    // what makes the Drop cleanup fire. Rewriting it to `_` silently
    // reintroduces the #561 leak.
    let (cancel_token, _cancel_token_guard) =
        DOWNLOAD_CANCEL_REGISTRY.register(&options.download_id);

    // Per-download CDN host health, shared by the video stream, audio
    // stream(s), every retry attempt, and their segment tasks. Dropping the
    // last Arc when this download ends clears the state (issue #527).
    let host_health = Arc::new(crate::utils::cdn_selector::HostHealth::new());

    // 1. The output path is reserved here (multi-process safe,
    //    issue #560/#595). The name claim + liveness lock live on a sidecar
    //    `video.mp4.lock`; all bytes are written to the reserved staging name
    //    (`{stem}.part.{ext}`) — created lazily by the writers — and renamed
    //    to the final name on success; `OutputReservation`'s Drop removes
    //    staging + sidecar on every early return below.
    let reservation = reserve_output_path(output_path)?;

    // 3. For bangumi, fetch player result to check is_preview and durl format.
    //    The DASH result is reused in step 4 to avoid a duplicate playurl request.
    //    CAUTION: the durl branch moves `player_result` into `download_bangumi_durl`
    //    and returns early, so only the DASH path reaches step 4. See issue #485.
    let (bangumi_preview_info, cached_bangumi_details) = if let Some(ep_id) = options.ep_id {
        let player_result = fetch_bangumi_player_result(api, ep_id, options.cid).await?;
        let is_preview = player_result.is_preview.map(|v| v == 1);

        // durl format (direct MP4 URL): consume player_result and return early.
        if player_result.dash.is_none() {
            // Finalize: rename the completed staging file to its final name;
            // on error the reservation's Drop removes the staging file.
            return download_bangumi_durl(
                app,
                options,
                reservation.reserved_path(),
                cookie_header,
                api,
                player_result,
                host_health,
                segment_concurrency,
            )
            .await
            .and_then(|_| reservation.complete())
            .map(|p| p.to_string_lossy().into_owned());
        }
        // DASH format: convert the already-fetched result instead of re-fetching.
        (
            is_preview,
            Some(bangumi_player_result_to_xplayer(player_result)?),
        )
    } else {
        (None, None)
    };

    // 4. Fetch video details (extract URL for selected quality) - DASH format.
    //    Bangumi DASH details were produced in step 3; this branch only fires
    //    for regular (non-bangumi) videos.
    let details = if let Some(cached) = cached_bangumi_details {
        cached
    } else {
        fetch_video_details(api, &options.bvid, options.cid).await?
    };

    let data = details.data.ok_or_else(|| {
        format!(
            "XPlayerApi error (code {}): {} - no data field",
            details.code, details.message
        )
    })?;

    // Regular video durl format (audio embedded in MP4). Wrapped in a block so
    // all early returns funnel through reservation.complete() (staging-file
    // finalize). Registry cleanup is handled by the CancelTokenGuard held in
    // download_video.
    if data.dash.is_none() {
        let result: Result<(), String> = async {
            let durl_segments = data
                .durl
                .as_ref()
                .ok_or_else(|| "ERR::NO_STREAM".to_string())?;
            let durl_segment = durl_segments.first().ok_or("ERR::QUALITY_NOT_FOUND")?;
            let video_url = durl_segment.url.clone();
            let backup_urls = durl_segment
                .backup_url
                .as_ref()
                .map(|urls| urls.iter().map(|s| s.to_string()).collect());

            // Emit quality resolved event for durl format (audio embedded)
            let page = options.page.unwrap_or(1);
            let resolved_video_quality = data.quality.unwrap_or(0);
            let video_quality_fallback =
                options.quality.is_some() && options.quality != Some(resolved_video_quality);
            app.emit(
                "download-quality-resolved",
                QualityResolvedPayload {
                    download_id: options.download_id.clone(),
                    page,
                    video_quality: resolved_video_quality,
                    video_quality_fallback,
                    // Constraint: durl format delivers a single muxed stream —
                    // Bilibili fixes the codec (AVC in practice) and exposes no
                    // codec choice, so priority is irrelevant and fallback is
                    // always false (issue #460).
                    video_codecid: CODECID_AVC,
                    video_codec_fallback: false,
                    audio_quality: None, // durl format has no separate audio
                    audio_quality_fallback: false,
                    audio_absent: false, // durl muxes the (existing) audio in
                    is_preview: None,
                },
            )
            .ok();

            if let Some(vs) = head_content_length(&video_url, Some(cookie_header)).await {
                ensure_free_space(reservation.reserved_path(), vs + 5 * 1024 * 1024)?;
            }

            let d_refetch_api = api.clone();
            let d_refetch_bvid = options.bvid.clone();
            let d_cid = options.cid;
            let d_ep_id = options.ep_id;
            let d_output_path = reservation.reserved_path().to_path_buf();
            retry_download(
                app,
                &options.download_id,
                Some("video"),
                move |attempt: u8| {
                    // Re-clone per call: async move consumes captured values, but
                    // FnMut may invoke the closure up to MAX_ATTEMPTS times.
                    let d_api = d_refetch_api.clone();
                    let bvid = d_refetch_bvid.clone();
                    let video_url = video_url.clone();
                    let backup_urls = backup_urls.clone();
                    let output_path = d_output_path.to_path_buf();
                    let cookie_header = cookie_header.to_string();
                    let download_id = options.download_id.clone();
                    let host_health = host_health.clone();
                    async move {
                        let (url, backups) = if attempt == 1 {
                            (video_url.clone(), backup_urls.clone())
                        } else {
                            log::info!(
                                "[BE] download_video: playurl refetch attempt={} for durl video",
                                attempt
                            );
                            match refetch_durl_url(&d_api, &bvid, d_cid, d_ep_id).await {
                                Ok(fresh) => fresh,
                                Err(e) => {
                                    log::warn!(
                                        "[BE] durl refetch failed, retrying with stale URL: {}",
                                        e
                                    );
                                    (video_url.clone(), backup_urls.clone())
                                }
                            }
                        };
                        download_url(
                            app,
                            url,
                            backups,
                            output_path,
                            Some(cookie_header),
                            true,
                            Some(download_id),
                            Some("video"),
                            true,
                            segment_concurrency,
                            host_health.clone(),
                        )
                        .await
                    }
                },
            )
            .await?;

            // History recording is settled by download_video's HistorySession
            // from the finalized path (issue #511).
            Ok(())
        }
        .await;

        // Finalize: rename the completed staging file to its final name; on
        // error the reservation's Drop removes the staging file. Registry
        // cleanup is handled by the CancelTokenGuard held in download_video.
        let result = result
            .and_then(|_| reservation.complete())
            .map(|p| p.to_string_lossy().into_owned());

        return result;
    }

    let dash_data = data.dash.unwrap();

    // Selection pool for the audio side: standard AAC plus the VIP-only
    // Dolby/Hi-Res objects that bilibili returns outside `dash.audio`
    // (issue #713). Built once, reused by selection and the fallback chain.
    let selectable_audio = dash_data.selectable_audio();

    // Seed the shared mirror pool from the whole DASH manifest (video +
    // audio streams, base + backup URLs) so the video pre-selection already
    // knows mirror hosts that only the audio streams carry (issue #527).
    let manifest_urls: Vec<String> = dash_data
        .video
        .iter()
        .chain(selectable_audio.iter())
        .flat_map(|s| {
            let mut v = vec![s.base_url.clone()];
            v.extend(s.backup_urls.clone().unwrap_or_default());
            v
        })
        .collect();
    host_health.seed_mirrors_from_urls(&manifest_urls);

    // Diagnostic: record the audio stream landscape split by source bucket.
    // `flac_id`/`dolby_ids` answer directly from reporter logs whether a
    // VIP account's manifest contained Hi-Res/Dolby entries (issues #467,
    // #713).
    log::info!(
        "[BE] download_video: dash audio landscape id={} audio_ids={:?} flac_id={:?} dolby_ids={:?}",
        options.download_id,
        dash_data.audio.iter().map(|a| a.id).collect::<Vec<_>>(),
        dash_data.flac.as_ref().and_then(|f| f.audio.as_ref()).map(|a| a.id),
        dash_data
            .dolby
            .as_ref()
            .map(|d| d.audio.iter().map(|a| a.id).collect::<Vec<_>>()),
    );

    // Resolve codec priority and filter streams, scoped to the requested
    // quality when it exists (HDR10/Dolby Vision are HEVC-only). Falls back
    // to all streams when the preferred codec is unavailable so the download
    // never fails.
    let (streams_for_selection, codec_selection) =
        select_streams_by_codec_priority_with(codec_priority, &dash_data.video, options.quality);

    // Fallback if selected quality is unavailable (first = highest quality)
    // None means best available → -1 won't match any real quality ID.
    let (video_url, video_backup_urls, raw_video_fallback) =
        select_stream_url(&streams_for_selection, options.quality)?;
    // Only treat as fallback when the user explicitly selected a quality.
    // When quality is None (accordion never opened), the best-available
    // selection is intentional and should not trigger the warning icon.
    let video_quality_fallback = options.quality.is_some() && raw_video_fallback;
    // Get the actual resolved video quality ID and codec ID
    let (resolved_video_quality, resolved_video_codecid) = dash_data
        .video
        .iter()
        .find(|v| v.base_url == video_url)
        .map(|v| (v.id, v.codecid))
        .unwrap_or((options.quality.unwrap_or(-1), CODECID_AVC));

    // True when the preferred codec was unavailable: either a lower-priority
    // codec was selected (fallback flag), or no priority codec existed at all
    // (None → fell back to all streams). The latter must also warn so users
    // notice when e.g. an H.264-only preference silently gets HEVC/AV1.
    let video_codec_fallback = codec_selection
        .as_ref()
        .map(|sel| sel.fallback)
        .unwrap_or(true);

    // Silent source (issue #446): the DASH manifest carries video streams but
    // no audio track (uploader recorded without sound). There is nothing to
    // select, download, or merge on the audio side — the merge step remuxes
    // the video stream alone.
    let audio_absent = selectable_audio.is_empty();

    let (audio_url, audio_backup_urls, raw_audio_fallback) = if audio_absent {
        (String::new(), None, false)
    } else {
        // Why: deliberately supersedes issue #713's "no-pick default is
        // 192K; Hi-Res/Dolby need an explicit pick" — tier-ranked selection
        // means a VIP manifest (selectable_audio() folds in the flac/dolby
        // entries) now defaults to its best documented tier (#762 follow-up).
        let audio_quality = options
            .audio_quality
            // Best effort: highest QUALITY rank, not the manifest's first
            // entry nor the numeric id (audio ids are not quality-ordered —
            // see `audio_quality_rank`).
            .unwrap_or_else(|| best_audio_quality_id(&selectable_audio).unwrap_or(30280));
        select_stream_url(&selectable_audio, Some(audio_quality))?
    };
    // Same logic: only warn when the user explicitly chose an audio quality.
    let audio_quality_fallback = options.audio_quality.is_some() && raw_audio_fallback;
    // Get the actual resolved audio quality ID
    let resolved_audio_quality = selectable_audio
        .iter()
        .find(|a| a.base_url == audio_url)
        .map(|a| a.id);

    log::info!(
        "[BE] download_video: resolved audio quality id={:?} (requested {:?}, audio_absent={}) for id={}",
        resolved_audio_quality,
        options.audio_quality,
        audio_absent,
        options.download_id,
    );

    // Emit quality resolved event to frontend
    let page = options.page.unwrap_or(1);
    app.emit(
        "download-quality-resolved",
        QualityResolvedPayload {
            download_id: options.download_id.clone(),
            page,
            video_quality: resolved_video_quality,
            video_quality_fallback,
            video_codecid: resolved_video_codecid,
            video_codec_fallback,
            audio_quality: resolved_audio_quality,
            audio_quality_fallback,
            audio_absent,
            is_preview: bangumi_preview_info,
        },
    )
    .ok();

    // 5. Pre-check disk space (skip if size cannot be determined)
    let video_size = head_content_length(&video_url, Some(cookie_header)).await;
    let audio_size = if audio_absent {
        None
    } else {
        head_content_length(&audio_url, Some(cookie_header)).await
    };
    // Why: gated on the video size alone — silent sources (#446) never have
    // an audio size, so a both-sizes gate would skip the space check for
    // every silent download.
    if let Some(vs) = video_size {
        // Audio size may be unknown (silent source / HEAD failure) — count 0
        let total_needed = vs + audio_size.unwrap_or(0) + (5 * 1024 * 1024); // 5MB buffer
        ensure_free_space(reservation.reserved_path(), total_needed)?;
    }

    // 6. Generate temp file paths
    let lib_path = lib_path.to_path_buf();
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", options.download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", options.download_id));

    // Hold an exclusive flock on both temp files' sidecar locks for the whole
    // download (issue #560/#595): startup cleanup treats a temp file whose
    // sidecar flock is free as an orphan (owner crashed) and deletes it
    // immediately regardless of age, so a second app instance must never see
    // an in-flight temp as garbage. The lock lives on a sidecar
    // (`temp_*.m4s.lock`), never on the payload: `download_url`'s
    // is_override entry unlinks and re-creates the payload, which would
    // orphan a payload-bound flock, and on Windows a mandatory LockFileEx on
    // the payload would block our own writers outright.
    // Note: keep the named binding — `let _ = lock_temp_paths(...)` would drop
    // the locks immediately, and startup cleanup would then delete these
    // in-flight temps as orphans.
    let _temp_locks = if audio_absent {
        lock_temp_paths(&[&temp_video_path])
    } else {
        lock_temp_paths(&[&temp_video_path, &temp_audio_path])
    };

    // Result to track success/failure for cleanup
    let result = async {
        // 7. Acquire semaphore + parallel download + merge
        // Semaphore is held until merge completes; concurrency is based on merge load
        let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

        let cookie = Some(cookie_header.to_string());

        // Download audio with fallback and video in parallel (cancel immediately if either fails)
        // Audio uses fallback to handle invalid media responses from VIP-specific CDN edges.
        // Skipped entirely for silent sources (issue #446): no audio exists.
        // Built unconditionally (cheap struct) so the returned future can keep
        // borrowing it for its whole lifetime.
        let audio_refetch_ctx = AudioRefetchCtx {
            api: api.clone(),
            bvid: options.bvid.clone(),
            cid: options.cid,
            ep_id: options.ep_id,
            audio_quality: resolved_audio_quality,
        };
        let audio_download = if audio_absent {
            None
        } else {
            Some(download_audio_with_fallback(
                app,
                codec_priority,
                segment_concurrency,
                &options.download_id,
                audio_url.clone(),
                audio_backup_urls.clone(),
                temp_audio_path.clone(),
                cookie.clone(),
                &selectable_audio,
                &audio_refetch_ctx,
                host_health.clone(),
            ))
        };
        // Refetch inputs for attempt > 1 (bilibili signed URLs expire after
        // 120 min). Cloned here because the move closure must own them, while
        // `cookie` is shared with audio_download and `cookies` with subtitle prep.
        let v_refetch_bvid = options.bvid.clone();
        let v_cid = options.cid;
        let v_ep_id = options.ep_id;
        let v_quality = resolved_video_quality;
        let v_download_id = options.download_id.clone();
        let v_video_url = video_url.clone();
        let v_video_backups = video_backup_urls.clone();
        let v_temp_video_path = temp_video_path.clone();
        let v_cookie = cookie.clone();
        // Subtitle prep runs after the video closure moves ; keep a clone.
        let sub_api = api.clone();
        let video_download = retry_download(
            app,
            &options.download_id,
            Some("video"),
            move |attempt: u8| {
                // Re-clone per call: async move consumes captured values, but
                // FnMut may invoke the closure up to MAX_ATTEMPTS times.
                let bvid = v_refetch_bvid.clone();
                let video_url = v_video_url.clone();
                let video_backup_urls = v_video_backups.clone();
                let temp_video_path = v_temp_video_path.clone();
                let v_api = api.clone();
                let cookie = v_cookie.clone();
                let download_id = v_download_id.clone();
                let host_health = host_health.clone();
                async move {
                    let (url, backups) = if attempt == 1 {
                        (video_url.clone(), video_backup_urls.clone())
                    } else {
                        log::info!(
                            "[BE] download_video: playurl refetch attempt={} for video",
                            attempt
                        );
                        match refetch_dash_urls(
                            &v_api,
                            codec_priority,
                            &bvid,
                            v_cid,
                            v_ep_id,
                            v_quality,
                            None,
                        )
                        .await
                        {
                            Ok(fresh) => (fresh.video_url, fresh.video_backup_urls),
                            Err(e) => {
                                log::warn!(
                                    "[BE] video refetch failed, retrying with stale URL: {}",
                                    e
                                );
                                (video_url.clone(), video_backup_urls.clone())
                            }
                        }
                    };
                    download_url(
                        app,
                        url,
                        backups,
                        temp_video_path,
                        cookie,
                        true,
                        Some(download_id),
                        None,
                        false, // emit_complete: will be emitted after merge
                        segment_concurrency,
                        host_health.clone(),
                    )
                    .await
                }
            },
        );

        match audio_download {
            Some(audio) => {
                tokio::try_join!(audio, video_download)?;
            }
            // Silent source: no audio future was created
            None => {
                video_download.await?;
            }
        }

        // Check for cancellation after download completes but before merge starts.
        // This TOCTOU fix prevents wasted ffmpeg launches when the user cancels
        // immediately after download finishes.
        if cancel_token.is_cancelled() {
            return Err("ERR::CANCELLED".to_string());
        }

        // Subtitle processing
        let (subtitle_mode, subtitle_language_labels, subtitle_failed_labels) =
            prepare_subtitle_mode(
                app,
                &sub_api,
                &options.subtitle,
                &options.bvid,
                options.cid,
                &options.download_id,
                &lib_path,
                Some(options.duration_seconds as f64),
            )
            .await?;

        // Emit subtitle resolved event to frontend
        let subtitle_mode_str = match &subtitle_mode {
            crate::handlers::ffmpeg::MergeMode::SoftSub(_) => "soft",
            crate::handlers::ffmpeg::MergeMode::HardSub(_) => "hard",
            crate::handlers::ffmpeg::MergeMode::None => "off",
        };
        app.emit(
            "download-subtitle-resolved",
            SubtitleResolvedPayload {
                download_id: options.download_id.clone(),
                page,
                subtitle_mode: subtitle_mode_str.to_string(),
                subtitle_language_labels,
            },
        )
        .ok();

        // Emit warning if any subtitle downloads failed
        if !subtitle_failed_labels.is_empty() {
            app.emit(
                "download-subtitle-warning",
                serde_json::json!({
                    "downloadId": options.download_id,
                    "failedLanguages": subtitle_failed_labels,
                }),
            )
            .ok();
        }

        // Keep subtitle file paths for cleanup
        let subtitle_paths: Vec<PathBuf> = match &subtitle_mode {
            crate::handlers::ffmpeg::MergeMode::SoftSub(subs) => {
                subs.iter().map(|s| s.path.clone()).collect()
            }
            crate::handlers::ffmpeg::MergeMode::HardSub(sub) => {
                vec![sub.path.clone()]
            }
            _ => vec![],
        };

        // Check cancellation before starting merge. A cancel that arrived
        // during the final chunk write can slip past download_url's check
        // (the chunk was already written), so without this guard we'd spawn
        // ffmpeg only to abort it on the first progress line (ERR::CANCELLED).
        if cancel_token.is_cancelled() {
            return Err("ERR::CANCELLED".to_string());
        }

        // Execute merge
        log::info!(
            "[BE] download_video: starting ffmpeg merge id={}",
            options.download_id
        );
        merge(
            &temp_video_path,
            // None for silent sources: the remux copies the video stream alone
            if audio_absent {
                None
            } else {
                Some(&temp_audio_path)
            },
            reservation.reserved_path(),
            subtitle_mode,
            cancel_token.clone(),
        )
        .await
        .map_err(|e| {
            log::error!(
                "[BE] download_video: ffmpeg merge failed id={}: {}",
                options.download_id,
                e
            );
            // Preserve ERR::CANCELLED so the frontend can detect cancellation
            // (otherwise it would be masked as ERR::MERGE_FAILED).
            if e.contains("CANCELLED") {
                e
            } else {
                String::from("ERR::MERGE_FAILED")
            }
        })?;

        // Release semaphore after merge completes
        drop(permit);

        // Delete temp files
        let _ = tokio::fs::remove_file(&temp_video_path).await;
        let _ = tokio::fs::remove_file(&temp_audio_path).await;
        for sub_path in subtitle_paths {
            let _ = tokio::fs::remove_file(&sub_path).await;
        }

        // Get actual file size from the staging file (still the merge output)
        let actual_file_size = tokio::fs::metadata(reservation.reserved_path())
            .await
            .ok()
            .map(|m| m.len());

        // Finalize: rename the staging file to the user-visible name.
        let final_path = reservation.complete()?;

        log::info!(
            "[BE] download_video: download complete id={}, size={:?}bytes",
            options.download_id,
            actual_file_size
        );

        // History recording is settled by download_video's HistorySession
        // from this return value (issue #511).

        Ok(final_path.to_string_lossy().into_owned())
    }
    .await;

    // Registry cleanup (token removal + pre-cancel flag clear) is handled by
    // the CancelTokenGuard acquired at register() above (issue #561).

    // Release the temp sidecar locks before removing them (required on
    // Windows: a held LockFileEx must be released before remove_file).
    drop(_temp_locks);
    // Remove the temp sidecars eagerly so zero-byte `.m4s.lock` files do not
    // linger in the lib dir until the next startup sweep (issue #595).
    for temp_path in [&temp_video_path, &temp_audio_path] {
        let _ = tokio::fs::remove_file(lock_sidecar_path(temp_path)).await;
    }

    // On error, clean up temp files
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_video_path).await;
        let _ = tokio::fs::remove_file(&temp_audio_path).await;
        // Clean up any subtitle files that may have been downloaded
        cleanup_subtitle_files(&lib_path, &options.download_id);
    }

    result
}

/// Cleans up temporary subtitle files for a download.
///
/// Removes any `.srt` files matching the download ID prefix from the lib directory.
/// This is called after download completion or failure to ensure temporary
/// files are removed.
///
/// # Arguments
///
/// * `lib_path` - Path to the library directory containing temporary files
/// * `download_id` - Unique identifier for the download (used as filename prefix)
///
/// # Example
///
/// Why: private fn; doctests compile as a separate crate and cannot import it
/// (enforced by the rust-test CI job)
/// ```ignore
/// # use std::path::Path;
/// # let lib_path = Path::new("/app/lib");
/// cleanup_subtitle_files(lib_path, "download-123");
/// // Removes files like: temp_sub_download-123_en.srt, temp_sub_download-123_ja.srt
/// ```
fn cleanup_subtitle_files(lib_path: &std::path::Path, download_id: &str) {
    let prefix = format!("temp_sub_{}_", download_id);
    if let Ok(entries) = std::fs::read_dir(lib_path) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&prefix) && name.ends_with(".srt") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    // ---- PR④: metadata fetchers via injected transport ----

    #[tokio::test]
    async fn fetch_user_info_with_maps_nav_response() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0", "ttl": 1,
                    "data": {"mid": 42, "uname": "tester", "isLogin": true,
                             "wbi_img": {"img_url": "i", "sub_url": "s"}}
                })),
            )
            .mount(&server)
            .await;

        let user = fetch_user_info_with(&bili_api_mock(&server.uri(), "SESSDATA=x"))
            .await
            .unwrap();
        assert_eq!(user.code, 0);
        assert!(user.has_cookie);
        assert!(user.data.is_login);
        assert_eq!(user.data.uname.as_deref(), Some("tester"));
        assert_eq!(user.data.mid, Some(42));
    }

    #[tokio::test]
    async fn fetch_user_info_with_maps_logged_out_nav() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": -101, "message": "not logged in", "ttl": 1,
                    "data": {"isLogin": false, "wbi_img": {"img_url": "i", "sub_url": "s"}}
                })),
            )
            .mount(&server)
            .await;

        let user = fetch_user_info_with(&bili_api_mock(&server.uri(), "SESSDATA=stale"))
            .await
            .unwrap();
        assert!(!user.data.is_login);
        assert!(user.has_cookie, "has_cookie reflects transport, not login");
    }

    #[tokio::test]
    async fn fetch_watch_history_with_maps_items_and_cursor() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/history/cursor"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "list": [{
                            "title": "Crossing the Alpha", "cover": "https://c/1.png",
                            "history": {"bvid": "BV1xx", "cid": 7, "page": 1},
                            "view_at": 1700000000, "duration": 120
                        }],
                        "cursor": {"view_at": 1700000000, "max": 1, "is_end": true}
                    }
                })),
            )
            .mount(&server)
            .await;

        let resp = fetch_watch_history_with(&bili_api_mock(&server.uri(), "SESSDATA=x"), 0, 0)
            .await
            .unwrap();
        assert_eq!(resp.entries.len(), 1);
        assert_eq!(resp.entries[0].bvid, "BV1xx");
        assert_eq!(resp.entries[0].title, "Crossing the Alpha");
        assert!(resp.cursor.is_end);
        assert_eq!(resp.cursor.max, 1);
    }

    #[tokio::test]
    async fn fetch_watch_history_with_unauthorized_and_first_page_query() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/history/cursor"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": -101, "message": "not logged in",
                    "data": {"list": [], "cursor": {"view_at": 0, "max": 0}}
                })),
            )
            .mount(&server)
            .await;

        let err = fetch_watch_history_with(&bili_api_mock(&server.uri(), "SESSDATA=stale"), 0, 0)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::UNAUTHORIZED");

        // First page omits max/view_at; subsequent pages carry them
        let requests = server.received_requests().await.unwrap();
        let query = requests[0].url.query().unwrap_or("");
        assert!(!query.contains("max="), "first page query was: {query}");

        let server2 = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/history/cursor"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"list": [], "cursor": {"view_at": 1, "max": 2}}
                })),
            )
            .mount(&server2)
            .await;
        fetch_watch_history_with(&bili_api_mock(&server2.uri(), "SESSDATA=x"), 5, 99)
            .await
            .unwrap();
        let reqs2 = server2.received_requests().await.unwrap();
        let q = reqs2[0].url.query().unwrap_or("");
        assert!(
            q.contains("max=5") && q.contains("view_at=99"),
            "query was: {q}"
        );
    }

    #[tokio::test]
    async fn fetch_subtitles_via_api_returns_dto_list() {
        let server = wiremock::MockServer::start().await;
        // nav (mixin key) + player v2
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/v2"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"subtitle": {"subtitles": [
                        {"lan": "zh-CN", "lan_doc": "中文",
                         "subtitle_url": "//cdn/ai_subtitle/zh.json", "ai_type": 1},
                        {"lan": "en", "lan_doc": "English", "subtitle_url": "https://cdn/en.json"}
                    ]}}
                })),
            )
            .mount(&server)
            .await;

        let subs = fetch_subtitles(&bili_api_mock(&server.uri(), "SESSDATA=x"), "BV1s", 1).await;
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0].lan, "zh-CN");
        assert!(subs[0].is_ai, "ai_type marks AI subtitles");
        assert!(!subs[1].is_ai);
        // DTO keeps the protocol-relative form; normalization to https is
        // deferred to download_subtitle
        assert!(subs[0].subtitle_url.starts_with("//"));
    }

    #[tokio::test]
    async fn fetch_subtitles_without_cookie_is_empty() {
        let subs = fetch_subtitles(&bili_api_mock("http://127.0.0.1:1", ""), "BV1s", 1).await;
        assert!(subs.is_empty(), "no cookie -> no HTTP, empty list");
    }

    #[tokio::test]
    async fn fetch_part_qualities_with_dash_lists_both() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 80, "dash": {
                        "video": [
                            {"id": 80, "codecid": 7, "bandwidth": 1, "width": 1920, "height": 1080,
                             "baseUrl": "http://127.0.0.1:1/v.m4s"},
                            {"id": 64, "codecid": 7, "bandwidth": 1, "width": 1280, "height": 720,
                             "baseUrl": "http://127.0.0.1:1/v64.m4s"}
                        ],
                        "audio": [
                            {"id": 30280, "codecid": 0, "bandwidth": 1, "width": 0, "height": 0,
                             "baseUrl": "http://127.0.0.1:1/a.m4s"}
                        ]
                    }}
                })),
            )
            .mount(&server)
            .await;

        let (video, audio, audio_absent) =
            fetch_part_qualities_with(&bili_api_mock(&server.uri(), "SESSDATA=x"), "BV1q", 1)
                .await
                .unwrap();
        assert_eq!(video.len(), 2);
        assert_eq!(audio.len(), 1);
        assert!(!audio_absent);
        assert!(video[0].id >= video[1].id, "qualities sorted desc");
    }

    #[tokio::test]
    async fn fetch_part_qualities_with_dash_no_audio_marks_absent() {
        // Issue #446: silent sources send "audio": null with video streams
        // intact; the response must parse and flag audio_absent.
        let server = wiremock::MockServer::start().await;
        mount_audio_stripped_playurl(&server).await;

        let (video, audio, audio_absent) =
            fetch_part_qualities_with(&bili_api_mock(&server.uri(), "SESSDATA=x"), "BV1q", 1)
                .await
                .unwrap();
        assert_eq!(video.len(), 2, "both dash video qualities listed");
        assert!(audio.is_empty());
        assert!(audio_absent);
    }

    #[tokio::test]
    async fn fetch_bangumi_part_qualities_with_dash_and_preview() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/pgc/player/web/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "result": {
                        "is_preview": 1,
                        "dash": {
                            "video": [{"id": 80, "codecid": 7, "bandwidth": 1,
                                        "width": 1920, "height": 1080,
                                        "baseUrl": "http://127.0.0.1:1/v.m4s"}],
                            "audio": [{"id": 30216, "codecid": 0, "bandwidth": 1,
                                        "width": 0, "height": 0,
                                        "baseUrl": "http://127.0.0.1:1/a.m4s"}]
                        }
                    }
                })),
            )
            .mount(&server)
            .await;

        let (video, audio, is_preview) =
            fetch_bangumi_part_qualities_with(&bili_api_mock(&server.uri(), ""), 999, 1)
                .await
                .unwrap();
        assert_eq!(video.len(), 1);
        assert_eq!(audio.len(), 1);
        assert_eq!(is_preview, Some(true), "is_preview=1 maps to Some(true)");
    }

    #[tokio::test]
    async fn download_subtitle_writes_srt_from_bcc() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "body": [
                        {"from": 0.0, "to": 2.5, "content": "hello"},
                        {"from": 3.0, "to": 4.0, "content": "world"}
                    ]
                })),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("zh.srt");
        download_subtitle(&Client::new(), &server.uri(), &out, None)
            .await
            .unwrap();

        let srt = std::fs::read_to_string(&out).unwrap();
        assert!(
            srt.contains("1\n00:00:00,000 --> 00:00:02,500\nhello"),
            "got:\n{srt}"
        );
        assert!(srt.contains("2\n00:00:03,000 --> 00:00:04,000\nworld"));
    }

    #[tokio::test]
    async fn download_subtitle_max_duration_skips_long_entries() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "body": [
                        {"from": 60.0, "to": 90.0, "content": "too long"},
                        {"from": 0.0, "to": 4.0, "content": "fits"}
                    ]
                })),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("zh.srt");
        // Cap semantics (utils/subtitle.rs): cues STARTING after max are
        // dropped; cues starting before max but ending after it are clamped.
        download_subtitle(&Client::new(), &server.uri(), &out, Some(50.0))
            .await
            .unwrap();

        let srt = std::fs::read_to_string(&out).unwrap();
        assert!(
            !srt.contains("too long"),
            "cue starting at 60s > 50s cap is dropped; got:\n{srt}"
        );
        assert!(srt.contains("fits"), "cue within cap survives");
    }

    // ---- PR③: pure seams ----

    #[test]
    fn build_output_path_in_appends_mp4_and_joins_dir() {
        let p = build_output_path_in(Some("/dl"), "video.MP4").unwrap();
        assert_eq!(p, PathBuf::from("/dl/video.MP4"));
        let p = build_output_path_in(Some("/dl"), "video").unwrap();
        assert_eq!(p, PathBuf::from("/dl/video.mp4"));
        let p = build_output_path_in(Some("/dl"), "clip.mp4").unwrap();
        assert_eq!(p, PathBuf::from("/dl/clip.mp4"));
    }

    #[test]
    fn build_output_path_in_requires_configured_path() {
        assert_eq!(
            build_output_path_in(None, "v.mp4").unwrap_err(),
            "Download output path is not configured"
        );
    }

    #[test]
    fn select_priority_scopes_quality_then_filters_codec() {
        use crate::utils::codec::VideoCodecPriority;
        // quality 80 has hevc+avc; priority AVC picks the avc entry only
        let streams = vec![stream(80, 12), stream(80, 7), stream(64, 7)];
        let (filtered, sel) =
            select_streams_by_codec_priority_with(VideoCodecPriority::AvcOnly, &streams, Some(80));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].codecid, 7);
        assert!(sel.is_some());
    }

    #[test]
    fn select_priority_falls_back_to_all_when_codec_missing() {
        use crate::utils::codec::VideoCodecPriority;
        // Only hevc available; avc-first keeps every stream
        let streams = vec![stream(80, 12)];
        let (filtered, sel) =
            select_streams_by_codec_priority_with(VideoCodecPriority::AvcOnly, &streams, None);
        assert_eq!(filtered.len(), 1);
        assert!(sel.is_none(), "no codec selection when preferred missing");
    }

    #[tokio::test]
    async fn head_content_length_with_parses_content_length() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("HEAD"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).insert_header("Content-Length", "4096"),
            )
            .mount(&server)
            .await;
        assert_eq!(
            head_content_length_with(&Client::new(), &server.uri(), None).await,
            Some(4096)
        );
    }

    #[tokio::test]
    async fn head_content_length_with_none_on_error_or_missing_header() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("HEAD"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&server)
            .await;
        assert_eq!(
            head_content_length_with(&Client::new(), &server.uri(), None).await,
            None
        );

        let server2 = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("HEAD"))
            .respond_with(wiremock::ResponseTemplate::new(200))
            .mount(&server2)
            .await;
        assert_eq!(
            head_content_length_with(&Client::new(), &server2.uri(), None).await,
            None,
            "200 without Content-Length is unknown size"
        );
    }

    // ---- PR③: retry_download loop (start_paused advances the backoff) ----

    /// Scripted closure: pops the next result per call.
    type ScriptedQueue =
        std::sync::Arc<std::sync::Mutex<std::vec::IntoIter<Result<(), anyhow::Error>>>>;
    type ScriptedFut = std::pin::Pin<
        std::boxed::Box<dyn std::future::Future<Output = Result<(), anyhow::Error>> + Send>,
    >;

    fn scripted(
        results: Vec<Result<(), anyhow::Error>>,
    ) -> (ScriptedQueue, impl FnMut(u8) -> ScriptedFut) {
        let queue: ScriptedQueue = std::sync::Arc::new(std::sync::Mutex::new(results.into_iter()));
        let q2 = queue.clone();
        (queue, move |_attempt| {
            let q = q2.clone();
            Box::pin(async move { q.lock().unwrap().next().unwrap_or(Ok(())) })
        })
    }

    #[tokio::test(start_paused = true)]
    async fn retry_download_retries_transient_then_succeeds() {
        let app = tauri::test::mock_app();
        let (queue, f) = scripted(vec![
            Err(anyhow::anyhow!("boom")),
            Err(anyhow::anyhow!("boom")),
            Ok(()),
        ]);
        retry_download(app.handle(), "pr3-a", None, f)
            .await
            .unwrap();
        assert!(queue.lock().unwrap().as_slice().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn retry_download_passes_non_retryable_err_immediately() {
        let app = tauri::test::mock_app();
        let (queue, f) = scripted(vec![Err(anyhow::anyhow!("ERR::DISK_FULL"))]);
        let err = retry_download(app.handle(), "pr3-b", None, f)
            .await
            .unwrap_err();
        assert!(err.contains("ERR::DISK_FULL"));
        drop(queue);
    }

    #[tokio::test(start_paused = true)]
    async fn retry_download_retries_whitelisted_invalid_media_then_succeeds() {
        let app = tauri::test::mock_app();
        let (_queue, f) = scripted(vec![
            Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE")),
            Ok(()),
        ]);
        retry_download(app.handle(), "pr3-c", None, f)
            .await
            .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn retry_download_wraps_exhausted_transient_as_network() {
        let app = tauri::test::mock_app();
        let (_, f) = scripted(vec![
            Err(anyhow::anyhow!("reset")),
            Err(anyhow::anyhow!("reset")),
            Err(anyhow::anyhow!("reset")),
        ]);
        let err = retry_download(app.handle(), "pr3-d", None, f)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::NETWORK::reset");
    }

    #[tokio::test(start_paused = true)]
    async fn retry_download_keeps_whitelisted_code_on_exhaustion() {
        let app = tauri::test::mock_app();
        let (_, f) = scripted(vec![
            Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE")),
            Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE")),
            Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE")),
        ]);
        let err = retry_download(app.handle(), "pr3-e", None, f)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::INVALID_MEDIA_RESPONSE");
    }

    // ---- PR③: audio fallback E2E (mock_app + wiremock, real download_url) ----

    use crate::models::bilibili_api::XPlayerApiResponseVideo;
    use crate::utils::cdn_selector::HostHealth;

    fn pr3_audio_stream(id: i32, url: &str) -> XPlayerApiResponseVideo {
        XPlayerApiResponseVideo {
            id,
            codecid: 0,
            bandwidth: 1,
            width: 0,
            height: 0,
            base_url: url.to_string(),
            backup_urls: None,
        }
    }

    /// Mounts the good-URL media mock: probe + segment GET both satisfied.
    async fn mount_good_media(server: &wiremock::MockServer, path: &str, body: Vec<u8>) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header(
                        "Content-Range",
                        format!("bytes 0-{}/{}", body.len() - 1, body.len()),
                    )
                    .insert_header("Content-Type", "application/octet-stream")
                    .set_body_bytes(body),
            )
            .mount(server)
            .await;
    }

    /// Mounts the bad-URL mock: media-typed 200 to Range-bearing probes and a
    /// JSON body (invalid media) to the Range-less fallback GET.
    async fn mount_bad_media(server: &wiremock::MockServer, path: &str) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .and(wiremock::matchers::header_exists("range"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/json")
                    .set_body_string("{\"code\":-404}"),
            )
            .mount(server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/json")
                    .set_body_string("error"),
            )
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn audio_fallback_primary_success_writes_exact_bytes() {
        let server = wiremock::MockServer::start().await;
        let body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        mount_good_media(&server, "/media/primary", body.clone()).await;

        let url = format!("{}/media/primary", server.uri());
        let dir = tempfile::tempdir().unwrap();
        let streams = vec![pr3_audio_stream(30280, &url)];

        let app = tauri::test::mock_app();
        let api = bili_api_mock(&server.uri(), "");
        let ctx = AudioRefetchCtx {
            api,
            bvid: "BV1pr3".into(),
            cid: 1,
            ep_id: None,
            audio_quality: Some(30280),
        };
        let out = dir.path().join("out.m4s");
        download_audio_with_fallback(
            app.handle(),
            crate::utils::codec::VideoCodecPriority::default(),
            1,
            "pr3-p1",
            url,
            None,
            out.clone(),
            None,
            &streams,
            &ctx,
            Arc::new(HostHealth::new()),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&out).unwrap(), body);
    }

    #[tokio::test]
    async fn audio_fallback_switches_stream_on_invalid_media() {
        let server = wiremock::MockServer::start().await;
        mount_bad_media(&server, "/media/primary").await;
        let alt_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_good_media(&server, "/media/alt", alt_body.clone()).await;

        let primary = format!("{}/media/primary", server.uri());
        let alt = format!("{}/media/alt", server.uri());
        let streams = vec![
            pr3_audio_stream(30280, &primary),
            pr3_audio_stream(30216, &alt),
        ];

        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let api = bili_api_mock(&server.uri(), "");
        let ctx = AudioRefetchCtx {
            api,
            bvid: "BV1pr3".into(),
            cid: 1,
            ep_id: None,
            audio_quality: Some(30280),
        };
        let out = dir.path().join("out.m4s");
        download_audio_with_fallback(
            app.handle(),
            crate::utils::codec::VideoCodecPriority::default(),
            1,
            "pr3-p2",
            primary,
            None,
            out.clone(),
            None,
            &streams,
            &ctx,
            Arc::new(HostHealth::new()),
        )
        .await
        .unwrap();

        assert_eq!(
            std::fs::read(&out).unwrap(),
            alt_body,
            "fallback stream content wins"
        );
    }

    #[tokio::test]
    async fn audio_fallback_pre_cancelled_aborts_without_http() {
        use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;
        let id = "pr3-cancel";
        let (_token, _guard) = DOWNLOAD_CANCEL_REGISTRY.register(id);
        DOWNLOAD_CANCEL_REGISTRY.cancel(id);

        let server = wiremock::MockServer::start().await;
        // No mocks mounted: any request would 404 and (worse) prove HTTP ran.
        let primary = format!("{}/media/primary", server.uri());
        let streams = vec![pr3_audio_stream(30280, &primary)];

        let dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let api = bili_api_mock(&server.uri(), "");
        let ctx = AudioRefetchCtx {
            api,
            bvid: "BV1pr3".into(),
            cid: 1,
            ep_id: None,
            audio_quality: Some(30280),
        };
        let err = download_audio_with_fallback(
            app.handle(),
            crate::utils::codec::VideoCodecPriority::default(),
            1,
            id,
            primary,
            None,
            dir.path().join("out.m4s"),
            None,
            &streams,
            &ctx,
            Arc::new(HostHealth::new()),
        )
        .await
        .unwrap_err();

        assert!(err.contains("ERR::CANCELLED"), "got: {err}");
        assert!(
            server.received_requests().await.unwrap().is_empty(),
            "no HTTP before the cancel guard"
        );
    }

    // ---- PR⑤: download_video_impl E2E (issue #646) ----
    //
    // Full staging→download→subtitle→merge→finalize pipeline against wiremock
    // + tempdir. `download_video_impl_with` receives the transport, paths,
    // settings-derived knobs, and a merge stand-in explicitly, so no real-home
    // state (settings.json, lib dir, ffmpeg binary) is touched.

    use crate::handlers::ffmpeg::MergeMode;
    use tokio_util::sync::CancellationToken;

    fn pr5_options(download_id: &str, ep_id: Option<i64>) -> DownloadOptions {
        DownloadOptions {
            bvid: "BV1pr5".into(),
            cid: 1,
            filename: "video".into(),
            quality: Some(80),
            audio_quality: Some(30280),
            download_id: download_id.into(),
            parent_id: None,
            duration_seconds: 10,
            thumbnail_url: None,
            page: Some(1),
            subtitle: None,
            ep_id,
        }
    }

    /// Mounts nav (mixin key) + a DASH playurl manifest whose video/audio
    /// baseUrls point at the given media URLs.
    async fn mount_dash_playurl(server: &wiremock::MockServer, video_url: &str, audio_url: &str) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 80, "dash": {
                        "video": [
                            {"id": 80, "codecid": 7, "bandwidth": 1, "width": 1920, "height": 1080,
                             "baseUrl": video_url}
                        ],
                        "audio": [
                            {"id": 30280, "codecid": 0, "bandwidth": 1, "width": 0, "height": 0,
                             "baseUrl": audio_url}
                        ]
                    }}
                })),
            )
            .mount(server)
            .await;
    }

    /// Mounts nav + the issue-#446 playurl shape: the DASH manifest carries
    /// video streams but `audio: null` (silent source).
    async fn mount_audio_stripped_playurl(server: &wiremock::MockServer) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 80, "dash": {
                        "video": [
                            {"id": 80, "codecid": 7, "bandwidth": 1,
                             "width": 1920, "height": 1080,
                             "baseUrl": format!("{}/media/v", server.uri())},
                            {"id": 64, "codecid": 7, "bandwidth": 1,
                             "width": 1280, "height": 720,
                             "baseUrl": format!("{}/media/v64", server.uri())}
                        ],
                        "audio": null
                    }}
                })),
            )
            .mount(server)
            .await;
    }

    /// Merge stand-in: concatenates the two staged streams into the output,
    /// mirroring what the real ffmpeg merge produces. With no audio (silent
    /// source) it copies the video bytes alone, matching the video-only remux.
    fn fake_merge<'a>(
        video_path: &'a Path,
        audio_path: Option<&'a Path>,
        output_path: &'a Path,
        _mode: MergeMode,
        _cancel: CancellationToken,
    ) -> MergeFuture<'a> {
        Box::pin(async move {
            let video = std::fs::read(video_path).map_err(|e| e.to_string())?;
            let mut merged = video;
            if let Some(audio_path) = audio_path {
                let audio = std::fs::read(audio_path).map_err(|e| e.to_string())?;
                merged.extend_from_slice(&audio);
            }
            std::fs::write(output_path, merged).map_err(|e| e.to_string())
        })
    }

    /// Merge stand-in that must never run (durl bypasses the merge step).
    fn unused_merge<'a>(
        _video_path: &'a Path,
        _audio_path: Option<&'a Path>,
        _output_path: &'a Path,
        _mode: MergeMode,
        _cancel: CancellationToken,
    ) -> MergeFuture<'a> {
        Box::pin(async { panic!("durl format must not reach the merge step") })
    }

    /// Merge stand-in simulating an ffmpeg failure.
    fn failing_merge<'a>(
        _video_path: &'a Path,
        _audio_path: Option<&'a Path>,
        _output_path: &'a Path,
        _mode: MergeMode,
        _cancel: CancellationToken,
    ) -> MergeFuture<'a> {
        Box::pin(async { Err("ffmpeg exploded".to_string()) })
    }

    #[tokio::test]
    async fn download_video_impl_dash_happy_path_merges_and_finalizes() {
        let server = wiremock::MockServer::start().await;
        let video_body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let audio_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_good_media(&server, "/media/v", video_body.clone()).await;
        mount_good_media(&server, "/media/a", audio_body.clone()).await;
        mount_dash_playurl(
            &server,
            &format!("{}/media/v", server.uri()),
            &format!("{}/media/a", server.uri()),
        )
        .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let final_path = download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-dash", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap();

        let expected_final = out_dir.path().join("video.mp4");
        assert_eq!(PathBuf::from(&final_path), expected_final);
        let mut expected = video_body;
        expected.extend_from_slice(&audio_body);
        assert_eq!(std::fs::read(&expected_final).unwrap(), expected);

        // Staging name, temp streams, and every flock sidecar are cleaned up.
        assert!(!out_dir.path().join("video.part.mp4").exists());
        assert!(!out_dir.path().join("video.mp4.lock").exists());
        assert!(!lib.path().join("temp_video_pr5-dash.m4s").exists());
        assert!(!lib.path().join("temp_audio_pr5-dash.m4s").exists());
        assert!(!lib.path().join("temp_video_pr5-dash.m4s.lock").exists());
        assert!(!lib.path().join("temp_audio_pr5-dash.m4s.lock").exists());
    }

    #[tokio::test]
    async fn download_video_impl_durl_writes_muxed_bytes_without_merge() {
        let server = wiremock::MockServer::start().await;
        let body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        mount_good_media(&server, "/media/mux", body.clone()).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 64, "durl": [
                        {"order": 1, "length": 1000, "size": body.len() as i64,
                         "url": format!("{}/media/mux", server.uri())}
                    ]}
                })),
            )
            .mount(&server)
            .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let final_path = download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-durl", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &unused_merge,
        )
        .await
        .unwrap();

        let expected_final = out_dir.path().join("video.mp4");
        assert_eq!(PathBuf::from(&final_path), expected_final);
        assert_eq!(std::fs::read(&expected_final).unwrap(), body);
        assert!(!out_dir.path().join("video.part.mp4").exists());
        assert!(!out_dir.path().join("video.mp4.lock").exists());
    }

    #[tokio::test]
    async fn download_video_impl_dash_no_audio_remuxes_video_only() {
        // Issue #446: silent source downloads the DASH video stream alone
        // and remuxes it without an audio input (fake_merge writes the video
        // bytes unchanged when audio is None).
        let server = wiremock::MockServer::start().await;
        let body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        mount_good_media(&server, "/media/v", body.clone()).await;
        mount_audio_stripped_playurl(&server).await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let final_path = download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-nosnd", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap();

        let expected_final = out_dir.path().join("video.mp4");
        assert_eq!(PathBuf::from(&final_path), expected_final);
        assert_eq!(std::fs::read(&expected_final).unwrap(), body);
        assert!(!out_dir.path().join("video.part.mp4").exists());
        assert!(!out_dir.path().join("video.mp4.lock").exists());
        // No audio stream was downloaded, so no audio temp exists either.
        assert!(!lib.path().join("temp_audio_pr5-nosnd.m4s").exists());
    }

    #[tokio::test]
    async fn download_video_impl_merge_failure_maps_to_merge_failed_and_cleans_up() {
        let server = wiremock::MockServer::start().await;
        let video_body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let audio_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_good_media(&server, "/media/v", video_body).await;
        mount_good_media(&server, "/media/a", audio_body).await;
        mount_dash_playurl(
            &server,
            &format!("{}/media/v", server.uri()),
            &format!("{}/media/a", server.uri()),
        )
        .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let err = download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-mergefail", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &failing_merge,
        )
        .await
        .unwrap_err();

        assert_eq!(err, "ERR::MERGE_FAILED");
        // Reservation Drop removed staging + sidecar; error cleanup removed
        // the temp streams; the final name never appeared.
        assert!(!out_dir.path().join("video.mp4").exists());
        assert!(!out_dir.path().join("video.part.mp4").exists());
        assert!(!out_dir.path().join("video.mp4.lock").exists());
        assert!(!lib.path().join("temp_video_pr5-mergefail.m4s").exists());
        assert!(!lib.path().join("temp_audio_pr5-mergefail.m4s").exists());
    }

    #[tokio::test]
    async fn download_video_impl_pre_cancelled_rejects_without_http() {
        use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;
        let id = "pr5-cancel";
        let (_token, guard) = DOWNLOAD_CANCEL_REGISTRY.register(id);
        DOWNLOAD_CANCEL_REGISTRY.cancel(id);

        // No mocks mounted: any request would 404 and (worse) prove HTTP ran.
        let server = wiremock::MockServer::start().await;
        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let err = download_video_impl_with(
            app.handle(),
            &pr5_options(id, None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap_err();

        assert_eq!(err, "ERR::CANCELLED");
        assert!(
            server.received_requests().await.unwrap().is_empty(),
            "no HTTP before the cancel guard"
        );
        // The pre-cancel flag is consumed so a retry of the same id runs.
        assert!(!DOWNLOAD_CANCEL_REGISTRY.is_cancelled(id));
        drop(guard);
    }

    #[tokio::test]
    async fn download_video_impl_bangumi_dash_merges_and_finalizes() {
        let server = wiremock::MockServer::start().await;
        let video_body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let audio_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_good_media(&server, "/media/v", video_body.clone()).await;
        mount_good_media(&server, "/media/a", audio_body.clone()).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/pgc/player/web/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "result": {"is_preview": 0, "dash": {
                        "video": [
                            {"id": 80, "codecid": 7, "bandwidth": 1, "width": 1920, "height": 1080,
                             "baseUrl": format!("{}/media/v", server.uri())}
                        ],
                        "audio": [
                            {"id": 30216, "codecid": 0, "bandwidth": 1, "width": 0, "height": 0,
                             "baseUrl": format!("{}/media/a", server.uri())}
                        ]
                    }}
                })),
            )
            .mount(&server)
            .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let mut options = pr5_options("pr5-bangumi", Some(999));
        options.audio_quality = Some(30216);
        let final_path = download_video_impl_with(
            app.handle(),
            &options,
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap();

        let expected_final = out_dir.path().join("video.mp4");
        assert_eq!(PathBuf::from(&final_path), expected_final);
        let mut expected = video_body;
        expected.extend_from_slice(&audio_body);
        assert_eq!(std::fs::read(&expected_final).unwrap(), expected);
        assert!(!out_dir.path().join("video.part.mp4").exists());
    }

    #[tokio::test]
    async fn download_video_impl_bangumi_durl_downloads_muxed_stream() {
        // Bangumi served in the legacy durl format (no dash): the muxed MP4
        // downloads straight to staging and finalizes without a merge
        // (unused_merge panics if the merge step is ever reached).
        let server = wiremock::MockServer::start().await;
        let body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        mount_good_media(&server, "/media/mux", body.clone()).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/pgc/player/web/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "result": {"is_preview": 0, "durls": [
                        {"quality": 64, "durl": [
                            {"order": 1, "length": 1000, "size": body.len() as i64,
                             "url": format!("{}/media/mux", server.uri())}
                        ]}
                    ]}
                })),
            )
            .mount(&server)
            .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        let mut options = pr5_options("pr5-bangumi-durl", Some(999));
        options.quality = Some(64);
        let final_path = download_video_impl_with(
            app.handle(),
            &options,
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &unused_merge,
        )
        .await
        .unwrap();

        let expected_final = out_dir.path().join("video.mp4");
        assert_eq!(PathBuf::from(&final_path), expected_final);
        assert_eq!(std::fs::read(&expected_final).unwrap(), body);
        assert!(!out_dir.path().join("video.part.mp4").exists());
        assert!(!out_dir.path().join("video.mp4.lock").exists());
    }

    /// Mounts one-shot invalid-media mocks on `path` (attempt 1 fails with
    /// the whitelisted ERR::INVALID_MEDIA_RESPONSE), then the good 206 mock
    /// serves every later request. Bad mocks are mounted first so they win
    /// wiremock's registration-order tie-break while hits remain.
    async fn mount_then_good_media(server: &wiremock::MockServer, path: &str, body: Vec<u8>) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .and(wiremock::matchers::header_exists("range"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/json")
                    .set_body_string("{\"code\":-404}"),
            )
            .up_to_n_times(1)
            .mount(server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/json")
                    .set_body_string("error"),
            )
            .up_to_n_times(1)
            .mount(server)
            .await;
        mount_good_media(server, path, body).await;
    }

    /// Counts recorded requests whose path contains `needle`.
    async fn count_requests(server: &wiremock::MockServer, needle: &str) -> usize {
        server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path().contains(needle))
            .count()
    }

    #[tokio::test]
    async fn download_video_impl_durl_refetches_playurl_on_retry() {
        // Attempt 1 serves an invalid-media body (whitelisted retry), so
        // attempt 2 must go through refetch_durl_url and succeed — the
        // refetch branch feeds a fresh signed URL into retry_download.
        let server = wiremock::MockServer::start().await;
        let body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        mount_then_good_media(&server, "/media/mux", body.clone()).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 64, "durl": [
                        {"order": 1, "length": 1000, "size": body.len() as i64,
                         "url": format!("{}/media/mux", server.uri())}
                    ]}
                })),
            )
            .mount(&server)
            .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-durl-refetch", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &unused_merge,
        )
        .await
        .unwrap();

        assert_eq!(
            std::fs::read(out_dir.path().join("video.mp4")).unwrap(),
            body
        );
        assert!(
            count_requests(&server, "/x/player/wbi/playurl").await >= 2,
            "playurl refetched on retry"
        );
    }

    #[tokio::test]
    async fn download_video_impl_dash_refetches_playurl_on_retry() {
        // Same retry shape on the DASH path: attempt 2 refetches fresh DASH
        // URLs and the download completes with a normal merge.
        let server = wiremock::MockServer::start().await;
        let video_body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let audio_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_then_good_media(&server, "/media/v", video_body.clone()).await;
        mount_good_media(&server, "/media/a", audio_body.clone()).await;
        mount_dash_playurl(
            &server,
            &format!("{}/media/v", server.uri()),
            &format!("{}/media/a", server.uri()),
        )
        .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-dash-refetch", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap();

        let mut expected = video_body;
        expected.extend_from_slice(&audio_body);
        assert_eq!(
            std::fs::read(out_dir.path().join("video.mp4")).unwrap(),
            expected
        );
        assert!(
            count_requests(&server, "/x/player/wbi/playurl").await >= 2,
            "playurl refetched on retry"
        );
    }

    #[tokio::test]
    async fn download_video_impl_dash_refetch_failure_falls_back_to_stale_url() {
        // The playurl mock only answers once: attempt 2's refetch fails
        // (404) and the retry must proceed with the stale signed URL
        // instead of failing the download.
        let server = wiremock::MockServer::start().await;
        let video_body: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let audio_body: Vec<u8> = (1..4097u32).map(|i| (i % 241) as u8).collect();
        mount_then_good_media(&server, "/media/v", video_body.clone()).await;
        mount_good_media(&server, "/media/a", audio_body.clone()).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {"quality": 80, "dash": {
                        "video": [
                            {"id": 80, "codecid": 7, "bandwidth": 1, "width": 1920, "height": 1080,
                             "baseUrl": format!("{}/media/v", server.uri())}
                        ],
                        "audio": [
                            {"id": 30280, "codecid": 0, "bandwidth": 1, "width": 0, "height": 0,
                             "baseUrl": format!("{}/media/a", server.uri())}
                        ]}
                    }
                })),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;

        let lib = tempfile::tempdir().unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_app();
        download_video_impl_with(
            app.handle(),
            &pr5_options("pr5-dash-stale", None),
            &bili_api_mock(&server.uri(), ""),
            lib.path(),
            &out_dir.path().join("video.mp4"),
            1,
            crate::utils::codec::VideoCodecPriority::default(),
            &fake_merge,
        )
        .await
        .unwrap();

        let mut expected = video_body;
        expected.extend_from_slice(&audio_body);
        assert_eq!(
            std::fs::read(out_dir.path().join("video.mp4")).unwrap(),
            expected
        );
        assert_eq!(
            count_requests(&server, "/x/player/wbi/playurl").await,
            2,
            "initial fetch + one failed refetch; the retry itself used the stale URL"
        );
    }

    // ---- R7: output path naming helpers ----

    #[test]
    fn part_path_appends_part_suffix() {
        assert_eq!(
            part_path(Path::new("/dl/video.mp4")),
            PathBuf::from("/dl/video.part.mp4")
        );
        // No extension: defaults to mp4
        assert_eq!(
            part_path(Path::new("/dl/video")),
            PathBuf::from("/dl/video.part.mp4")
        );
    }

    #[test]
    fn lock_sidecar_path_appends_lock() {
        assert_eq!(
            lock_sidecar_path(Path::new("/dl/video.mp4")),
            PathBuf::from("/dl/video.mp4.lock")
        );
        assert_eq!(
            lock_sidecar_path(Path::new("/dl/temp_video_0.m4s")),
            PathBuf::from("/dl/temp_video_0.m4s.lock")
        );
    }

    #[test]
    fn candidate_output_paths_start_with_desired_then_parenthesized() {
        let candidates = candidate_output_paths(Path::new("/dl/v.mp4"));
        assert_eq!(candidates[0], PathBuf::from("/dl/v.mp4"));
        assert_eq!(candidates[1], PathBuf::from("/dl/v (1).mp4"));
        assert_eq!(candidates[2], PathBuf::from("/dl/v (2).mp4"));
        assert_eq!(candidates.len(), 10_001);
    }

    use super::*;

    /// Tests the E2E fixture `Video` mapping used under E2E_TESTING.
    ///
    /// Verifies the bundled 2-page fixture maps to a Video with both
    /// parts and the requested bvid, matching what E2E specs assert
    /// (part indices 0 and 1).
    #[test]
    fn test_e2e_mock_video_info() {
        let video = e2e_mock_video_info("BV1FV411d7u7").expect("fixture maps");
        assert_eq!(video.bvid, "BV1FV411d7u7");
        assert_eq!(video.content_type, "video");
        assert!(!video.title.is_empty());
        assert_eq!(video.parts.len(), 3);
        assert_eq!(video.parts[0].cid, 186803402);
        assert_eq!(video.parts[0].page, 1);
        assert_eq!(video.parts[1].cid, 186917910);
        assert_eq!(video.parts[1].page, 2);
        assert_eq!(video.parts[2].cid, 189702747);
        assert_eq!(video.parts[2].page, 3);
    }

    #[test]
    fn api_base_with_e2e_override_matrix() {
        // Only E2E_TESTING + a set override redirects; every other case keeps
        // the production base (including E2E runs without E2E_API_BASE).
        assert_eq!(
            api_base_with_e2e_override(true, Some("http://127.0.0.1:1".into())),
            "http://127.0.0.1:1"
        );
        assert_eq!(api_base_with_e2e_override(true, None), API_BASE);
        assert_eq!(
            api_base_with_e2e_override(false, Some("http://127.0.0.1:1".into())),
            API_BASE
        );
    }

    #[test]
    fn e2e_mock_video_info_swaps_pic_under_fixture_base() {
        // Fixture server configured: the hdslb.com snapshot URLs (video pic
        // and any page first_frame, which the part mapper prefers) are
        // swapped for the committed localhost thumbnail on every part.
        let video = e2e_mock_video_info_with_pic_base("BV1FV411d7u7", Some("http://127.0.0.1:2"))
            .expect("fixture maps");
        for part in &video.parts {
            assert_eq!(part.thumbnail.url, "http://127.0.0.1:2/media/thumb.png");
        }

        // No fixture server (plain unit runs): the snapshot value is kept
        // (this snapshot has no page first_frames, so every part uses pic).
        let video = e2e_mock_video_info_with_pic_base("BV1FV411d7u7", None).expect("fixture maps");
        for part in &video.parts {
            assert!(part.thumbnail.url.starts_with("http://i0.hdslb.com/"));
        }
    }

    /// Tests quality ID to human-readable string conversion.
    ///
    /// Verifies that known quality IDs produce expected display names
    /// per the official playurl qn table and unknown IDs fall back to
    /// "Q{id}" format.
    #[test]
    fn test_quality_to_string() {
        assert_eq!(quality_to_string(&127), "8K");
        assert_eq!(quality_to_string(&126), "Dolby Vision");
        assert_eq!(quality_to_string(&125), "HDR10");
        assert_eq!(quality_to_string(&120), "4K");
        assert_eq!(quality_to_string(&116), "1080P60");
        assert_eq!(quality_to_string(&112), "1080P+");
        assert_eq!(quality_to_string(&80), "1080P");
        assert_eq!(quality_to_string(&74), "720P60");
        assert_eq!(quality_to_string(&64), "720P");
        assert_eq!(quality_to_string(&32), "480P");
        assert_eq!(quality_to_string(&16), "360P");
        assert_eq!(quality_to_string(&999), "Q999");
    }

    /// Tests that all known quality IDs produce non-empty output.
    ///
    /// Ensures the quality_to_string function handles all supported
    /// quality levels without returning empty strings.
    #[test]
    fn test_quality_to_string_coverage() {
        let known_qualities = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16];
        for q in known_qualities {
            let result = quality_to_string(&q);
            assert!(
                !result.is_empty(),
                "Quality {} should produce non-empty string",
                q
            );
        }
    }

    /// Tests quality scoping for codec-priority stream selection (issue #584).
    ///
    /// HDR10 / Dolby Vision are HEVC-only; scoping keeps them selectable even
    /// when the codec priority prefers another codec.
    #[test]
    fn test_scope_streams_to_quality() {
        // 1080P60 AV1 + HDR10 HEVC-only manifest.
        let streams = vec![
            stream(116, crate::utils::codec::CODECID_AV1),
            stream(125, crate::utils::codec::CODECID_HEVC),
        ];

        // Requested quality present: only its streams remain.
        let scoped = scope_streams_to_quality(&streams, Some(125));
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].id, 125);

        // Requested quality absent: all streams remain (legacy fallback).
        let unscoped = scope_streams_to_quality(&streams, Some(120));
        assert_eq!(unscoped.len(), 2);

        // No explicit quality (best-available): all streams remain.
        let none = scope_streams_to_quality(&streams, None);
        assert_eq!(none.len(), 2);
    }

    /// Tests DASH-format bangumi result conversion.
    ///
    /// Verifies that a `BangumiPlayerResult` with DASH data is converted into a
    /// success `XPlayerApiResponse` that preserves the `dash` field and leaves
    /// the durl-only fields as `None`.
    #[test]
    fn test_bangumi_player_result_to_xplayer_with_dash() {
        use crate::models::bilibili_api::XPlayerApiResponseDash;
        use std::collections::HashMap;

        let result = BangumiPlayerResult {
            dash: Some(XPlayerApiResponseDash {
                video: vec![],
                audio: vec![],
                dolby: None,
                flac: None,
                extra: HashMap::new(),
            }),
            durl: None,
            durls: None,
            support_formats: None,
            quality: None,
            is_preview: None,
            timelength: None,
        };

        let xplayer = bangumi_player_result_to_xplayer(result).unwrap();
        assert_eq!(xplayer.code, 0);
        assert_eq!(xplayer.message, "success");
        let data = xplayer.data.expect("data should be present");
        assert!(data.dash.is_some(), "dash should be preserved");
        assert!(data.durl.is_none());
        assert!(data.support_formats.is_none());
        assert!(data.quality.is_none());
    }

    /// Tests durl-only bangumi result rejection.
    ///
    /// Verifies that a `BangumiPlayerResult` without DASH data returns
    /// `ERR::BANGUMI_DURL_NOT_SUPPORTED`. Callers must route durl format to
    /// `download_bangumi_durl` before calling this function.
    #[test]
    fn test_bangumi_player_result_to_xplayer_durl_only() {
        let result = BangumiPlayerResult {
            dash: None,
            durl: None,
            durls: Some(vec![]),
            support_formats: None,
            quality: None,
            is_preview: None,
            timelength: None,
        };

        let err = bangumi_player_result_to_xplayer(result).unwrap_err();
        assert_eq!(err, "ERR::BANGUMI_DURL_NOT_SUPPORTED");
    }

    // ---- validate_api_response ----

    // Why: ERR::* literals are a cross-boundary contract — the frontend maps
    //   these exact strings to i18n keys (src/shared/lib/mapBackendError.ts;
    //   see "Map backend ERR:: error codes" in CLAUDE.md), so a renamed code
    //   must be mirrored there and in all 6 locale files.
    #[test]
    fn validate_api_response_maps_error_codes() {
        // -101 drives the frontend to the login prompt; -404 to video error.
        assert_eq!(
            validate_api_response::<serde_json::Value>(-101, None),
            Err("ERR::UNAUTHORIZED".to_string())
        );
        assert_eq!(
            validate_api_response::<serde_json::Value>(-404, None),
            Err("ERR::VIDEO_NOT_FOUND".to_string())
        );
    }

    #[test]
    fn validate_api_response_requires_data_on_success() {
        let data = serde_json::json!({"pages": []});
        assert!(validate_api_response(0, Some(&data)).is_ok());
        // code 0 with no data field (empty payload) is an API error, not success
        assert_eq!(
            validate_api_response::<serde_json::Value>(0, None),
            Err("ERR::API_ERROR".to_string())
        );
        // any other non-zero code falls through to the generic API error
        assert_eq!(
            validate_api_response::<serde_json::Value>(62002, Some(&data)),
            Err("ERR::API_ERROR".to_string())
        );
    }

    // ---- check_http_status ----

    #[test]
    fn check_http_status_classifies_status_ranges() {
        use reqwest::StatusCode;

        assert!(check_http_status(StatusCode::OK).is_ok());
        assert!(check_http_status(StatusCode::CREATED).is_ok());
        assert!(check_http_status(StatusCode::PARTIAL_CONTENT).is_ok());

        assert_eq!(
            check_http_status(StatusCode::TOO_MANY_REQUESTS),
            Err("ERR::RATE_LIMITED".to_string())
        );
        assert_eq!(
            check_http_status(StatusCode::FORBIDDEN),
            Err("ERR::API_ERROR".to_string())
        );
        assert_eq!(
            check_http_status(StatusCode::INTERNAL_SERVER_ERROR),
            Err("ERR::API_ERROR".to_string())
        );
    }

    // ---- validate_bangumi_response ----

    #[test]
    fn validate_bangumi_response_maps_special_codes() {
        assert!(validate_bangumi_response(0, "").is_ok());
        assert_eq!(
            validate_bangumi_response(-101, ""),
            Err("ERR::UNAUTHORIZED".to_string())
        );
        assert_eq!(
            validate_bangumi_response(-404, ""),
            Err("ERR::BANGUMI_NOT_FOUND".to_string())
        );
        assert_eq!(
            validate_bangumi_response(-403, ""),
            Err("ERR::BANGUMI_ACCESS_DENIED".to_string())
        );
        assert_eq!(
            validate_bangumi_response(-688, ""),
            Err("ERR::BANGUMI_REGION_RESTRICTED".to_string())
        );
        assert_eq!(
            validate_bangumi_response(-689, ""),
            Err("ERR::BANGUMI_COPYRIGHT_RESTRICTED".to_string())
        );
    }

    #[test]
    fn validate_bangumi_response_includes_code_and_message() {
        let err = validate_bangumi_response(-999, "boom").unwrap_err();
        assert!(
            err.starts_with("ERR::API_ERROR (code -999): "),
            "generic error must embed code and message: {err}"
        );
    }

    // ---- first_non_empty (promoted from ignored doctest) ----

    #[test]
    fn first_non_empty_returns_first_non_empty_string() {
        let empty = "".to_string();
        let a = "1080P".to_string();
        let b = "720P".to_string();
        let options = vec![&empty, &a, &b];
        assert_eq!(first_non_empty(&options), Some("1080P".to_string()));
        assert_eq!(first_non_empty(&[&empty]), None);
        assert_eq!(first_non_empty(&[]), None);
    }

    // ---- extract_bangumi_ep_id (promoted from ignored doctest) ----

    #[test]
    fn extract_bangumi_ep_id_parses_redirect_urls() {
        assert_eq!(
            extract_bangumi_ep_id("https://www.bilibili.com/bangumi/play/ep3051843"),
            Some(3051843)
        );
        // Trailing path segments after the numeric id are ignored
        assert_eq!(
            extract_bangumi_ep_id("https://www.bilibili.com/bangumi/play/ep123?from=search"),
            Some(123)
        );
        assert_eq!(
            extract_bangumi_ep_id("https://www.bilibili.com/video/BV1xx"),
            None
        );
        assert_eq!(
            extract_bangumi_ep_id("https://www.bilibili.com/bangumi/play/ss123"),
            None
        );
    }

    // ---- url_host ----

    #[test]
    fn url_host_hides_signed_query_params() {
        // Signed CDN URLs carry auth params that must never reach logs.
        assert_eq!(
            url_host("https://upos-sz-mirror08h.bilivideo.com/vod/x.m4s?upsig=secret&deadline=1"),
            "upos-sz-mirror08h.bilivideo.com".to_string()
        );
        assert_eq!(url_host("not a url"), "<invalid>".to_string());
    }

    // ---- build_cookie_header ----

    #[test]
    fn build_cookie_header_filters_non_bilibili_hosts() {
        use crate::models::cookie::CookieEntry;

        let cookies = vec![
            CookieEntry {
                host: ".bilibili.com".into(),
                name: "SESSDATA".into(),
                value: "abc".into(),
            },
            CookieEntry {
                host: ".biliapi.net".into(),
                name: "OTHER".into(),
                value: "x".into(),
            },
            CookieEntry {
                host: "bilibili.com".into(),
                name: "buvid3".into(),
                value: "y".into(),
            },
        ];
        assert_eq!(build_cookie_header(&cookies), "SESSDATA=abc; buvid3=y");
        assert_eq!(build_cookie_header(&[]), "");
    }

    // ---- convert_qualities ----

    fn stream(id: i32, codecid: i16) -> crate::models::bilibili_api::XPlayerApiResponseVideo {
        crate::models::bilibili_api::XPlayerApiResponseVideo {
            id,
            codecid,
            bandwidth: 0,
            width: 0,
            height: 0,
            base_url: format!("https://example.com/{id}.m4s"),
            backup_urls: None,
        }
    }

    #[test]
    fn convert_qualities_dedupes_by_highest_codecid_and_sorts_desc() {
        let streams = vec![
            stream(80, 7),  // avc 1080P
            stream(80, 12), // av1 1080P — higher codecid wins the slot
            stream(64, 7),  // 720P
        ];
        let qualities = convert_qualities(&streams, video_quality_rank);
        let ids: Vec<i32> = qualities.iter().map(|q| q.id).collect();
        assert_eq!(ids, vec![80, 64], "qualities sorted best-first");
        assert_eq!(qualities[0].codecid, 12, "highest codecid kept for 80");
        assert_eq!(qualities[0].quality, "1080P");
        assert_eq!(qualities[1].quality, "720P");
    }

    #[test]
    fn audio_quality_rank_ladder_beats_numeric_order() {
        // Documented tier ladder: Hi-Res > Dolby > 192K > 132K > 64K, even
        // though 192K (30280) is numerically the largest id.
        assert!(audio_quality_rank(30251) > audio_quality_rank(30250));
        assert!(audio_quality_rank(30250) > audio_quality_rank(30280));
        assert!(audio_quality_rank(30280) > audio_quality_rank(30232));
        assert!(audio_quality_rank(30232) > audio_quality_rank(30216));
        // Undocumented ids rank below every known tier.
        assert!(audio_quality_rank(30255) < audio_quality_rank(30216));
    }

    #[test]
    fn best_audio_quality_id_prefers_hires_over_numeric_max() {
        let streams = vec![stream(30280, 0), stream(30251, 0), stream(30216, 0)];
        assert_eq!(best_audio_quality_id(&streams), Some(30251));

        // AAC-only manifest: unchanged 192K default.
        let aac = vec![stream(30216, 0), stream(30280, 0)];
        assert_eq!(best_audio_quality_id(&aac), Some(30280));

        // Undocumented tier (e.g. a Dolby variant) is never auto-picked.
        let with_unknown = vec![stream(30280, 0), stream(30255, 0)];
        assert_eq!(best_audio_quality_id(&with_unknown), Some(30280));
    }

    #[test]
    fn convert_qualities_sorts_audio_by_quality_rank() {
        let streams = vec![
            stream(30216, 0),
            stream(30280, 0),
            stream(30250, 0),
            stream(30251, 0),
            stream(30255, 0), // undocumented — sorts below known tiers
        ];
        let qualities = convert_qualities(&streams, audio_quality_rank);
        let ids: Vec<i32> = qualities.iter().map(|q| q.id).collect();
        assert_eq!(ids, vec![30251, 30250, 30280, 30216, 30255]);
    }

    // ---- select_stream_url ----

    #[test]
    fn select_stream_url_exact_match_marks_no_fallback() {
        let items = vec![stream(80, 7), stream(64, 7)];
        let (url, _backup, fell_back) = select_stream_url(&items, Some(64)).unwrap();
        assert_eq!(url, "https://example.com/64.m4s");
        assert!(!fell_back);
    }

    #[test]
    fn best_effort_not_capped_by_codec_priority() {
        // AV1 1080p+ exists, but HDR10 (125) is HEVC-only and higher —
        // best effort must take 125; codec priority only tie-breaks within
        // the same rendition id.
        let items = vec![stream(112, 12), stream(125, 7)];
        let (scoped, _) = select_streams_by_codec_priority_with(
            crate::utils::codec::VideoCodecPriority::Av1First,
            &items,
            None,
        );
        let (url, _, _) = select_stream_url(&scoped, None).unwrap();
        assert_eq!(url, "https://example.com/125.m4s");
    }

    #[test]
    fn select_stream_url_none_picks_highest_not_manifest_order() {
        // Regression (verification): manifest listed 1080p+ (112) BEFORE
        // HDR10 (125) — best-effort must still take the highest id.
        let items = vec![stream(112, 7), stream(125, 7), stream(80, 7)];
        let (url, _, fell_back) = select_stream_url(&items, None).unwrap();
        assert_eq!(url, "https://example.com/125.m4s");
        assert!(!fell_back, "best effort is intentional, not a fallback");
    }

    #[test]
    fn select_stream_url_unknown_quality_falls_back_to_first() {
        let items = vec![stream(80, 7), stream(64, 7)];
        let (url, _, fell_back) = select_stream_url(&items, Some(127)).unwrap();
        assert_eq!(url, "https://example.com/80.m4s");
        assert!(fell_back, "caller shows a quality-fallback warning");
    }

    #[test]
    fn select_stream_url_empty_list_errors() {
        assert_eq!(
            select_stream_url(&[], Some(80)),
            Err("ERR::QUALITY_NOT_FOUND".to_string())
        );
    }

    // ---- reserve_output_path / OutputReservation (fs, tempfile) ----

    #[test]
    fn reserve_appends_counter_when_final_name_taken() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("video.mp4");
        std::fs::write(&original, b"x").unwrap();

        let reservation = reserve_output_path(&original).unwrap();
        assert_eq!(
            reservation.reserved_path().file_name().unwrap(),
            "video (1).part.mp4",
            "existing final file pushes us to the (1) variant staging name"
        );

        std::fs::write(reservation.reserved_path(), b"x").unwrap();
        let second = reserve_output_path(&original).unwrap();
        assert_eq!(
            second.reserved_path().file_name().unwrap(),
            "video (2).part.mp4"
        );
    }

    #[test]
    fn reserve_uses_plain_name_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("never_written.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        assert_eq!(
            reservation.reserved_path().file_name().unwrap(),
            "never_written.part.mp4"
        );
        // The claim + liveness lock live on the sidecar, not the payload
        // (issue #595): the sidecar exists from the moment of reservation,
        // while the staging payload is only created by writers.
        assert!(reservation_exists(dir.path(), "never_written.mp4.lock"));
        assert!(!reservation_exists(dir.path(), "never_written.part.mp4"));
    }

    #[test]
    fn reservation_locks_sidecar_not_payload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        let reservation = reserve_output_path(&path).unwrap();

        // The sidecar flock is held: a try_lock from a second handle fails.
        let sidecar = dir.path().join("video.mp4.lock");
        assert!(
            flock_is_held(&sidecar),
            "live reservation must hold the sidecar flock"
        );
        drop(reservation);
    }

    #[test]
    fn staging_is_writable_while_reservation_held() {
        // The #595 invariant: nothing the download writes is ever locked.
        // On Windows the old payload-bound flock made this write fail with
        // os error 33 (LockFileEx mandatory lock) — the exact failure behind
        // "Permission denied" in the ffmpeg merge.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        let reservation = reserve_output_path(&path).unwrap();

        use std::io::Write;
        let mut writer = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(reservation.reserved_path())
            .unwrap();
        writer.write_all(b"payload bytes").unwrap();

        drop(reservation);
    }

    #[test]
    fn orphan_sidecar_is_reclaimed_on_next_reserve() {
        // Simulate a crashed process: an unlocked sidecar with no payload.
        // The next reserve for the same name reclaims it instead of jumping
        // to " (1)".
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        std::fs::write(lock_sidecar_path(&path), b"").unwrap();

        let reservation = reserve_output_path(&path).unwrap();
        assert_eq!(
            reservation.reserved_path().file_name().unwrap(),
            "video.part.mp4",
            "dead sidecar is reclaimed, not skipped"
        );
    }

    #[test]
    fn concurrent_reservations_never_share_a_staging_file() {
        // Two live reservations for the same desired name must land on
        // different candidates — the O_EXCL create makes slipping through
        // the same name impossible.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("race.mp4");
        let a = reserve_output_path(&path).unwrap();
        let b = reserve_output_path(&path).unwrap();
        assert_ne!(a.reserved_path(), b.reserved_path());
    }

    #[test]
    fn complete_renames_staging_to_final() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("done.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        std::fs::write(reservation.reserved_path(), b"payload").unwrap();
        let final_path = reservation.complete().unwrap();
        assert_eq!(final_path, path);
        assert_eq!(std::fs::read(&path).unwrap(), b"payload");
        assert!(!reservation_exists(dir.path(), "done.part.mp4"));
        assert!(
            !reservation_exists(dir.path(), "done.mp4.lock"),
            "completing must release and remove the sidecar claim"
        );
    }

    #[test]
    fn complete_without_staging_fails_and_releases_claim() {
        // Writers never ran (early failure before any bytes). complete()
        // fails loudly on the missing rename source and Drop still releases
        // the claimed name.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("never_started.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        assert!(reservation.complete().is_err());
        // complete() consumes the reservation; Drop ran inside it.
        assert!(!reservation_exists(dir.path(), "never_started.mp4.lock"));
        assert!(!reservation_exists(dir.path(), "never_started.part.mp4"));
    }

    #[test]
    fn drop_without_complete_removes_staging_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abandoned.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        std::fs::write(reservation.reserved_path(), b"partial").unwrap();
        drop(reservation);
        assert!(!reservation_exists(dir.path(), "abandoned.part.mp4"));
        assert!(
            !reservation_exists(dir.path(), "abandoned.mp4.lock"),
            "dropping must release and remove the sidecar claim"
        );
        assert!(!path.exists(), "final name must stay untouched on failure");
    }

    #[test]
    fn dead_reservation_is_reclaimed_on_next_reserve() {
        // Simulate pre-#595 crash debris: a staging file exists with no
        // sidecar, so the name is claimable. The next reserve reuses the
        // name (writers overwrite the stale staging bytes) instead of
        // jumping to " (1)".
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        std::fs::write(part_path(&path), b"orphan").unwrap();

        let reservation = reserve_output_path(&path).unwrap();
        assert_eq!(
            reservation.reserved_path().file_name().unwrap(),
            "video.part.mp4",
            "dead reservation is reclaimed, not skipped"
        );
    }

    /// Test helper: does `name` exist in `dir`?
    fn reservation_exists(dir: &std::path::Path, name: &str) -> bool {
        dir.join(name).exists()
    }

    /// Test helper: is an exclusive flock currently held on `path` by
    /// someone else?
    fn flock_is_held(path: &std::path::Path) -> bool {
        let probe = OpenOptions::new()
            .write(true)
            .read(true)
            .open(path)
            .unwrap();
        probe.try_lock_exclusive().is_err()
    }

    #[test]
    fn complete_shifts_to_next_variant_when_final_appeared() {
        // Another instance completed the same filename while we were
        // downloading: complete() must not clobber the finished file.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("video.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        std::fs::write(&path, b"winner").unwrap();
        std::fs::write(reservation.reserved_path(), b"ours").unwrap();

        let final_path = reservation.complete().unwrap();

        assert_eq!(final_path.file_name().unwrap(), "video (1).mp4");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"winner",
            "finished file must not be overwritten"
        );
        assert_eq!(std::fs::read(&final_path).unwrap(), b"ours");
        // The sidecar is named after the CLAIMED candidate (video.mp4), so
        // shifting the rename target does not change which claim is removed.
        assert!(!reservation_exists(dir.path(), "video.mp4.lock"));
    }

    #[test]
    fn lock_temp_paths_locks_sidecars_not_payloads() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join("temp_video_dl-1.m4s");
        let guards = lock_temp_paths(&[&temp]);

        // Sidecar exists and is locked for the guard's lifetime; the payload
        // is neither created nor locked (issue #595).
        let sidecar = dir.path().join("temp_video_dl-1.m4s.lock");
        assert!(sidecar.exists());
        assert!(
            !temp.exists(),
            "lock_temp_paths must not create the payload"
        );
        assert!(
            flock_is_held(&sidecar),
            "temp sidecar must be flock-held while the download lives"
        );

        // Payload writes (download_url's second handle) work unimpeded.
        std::fs::write(&temp, b"segment bytes").unwrap();

        drop(guards);
        assert!(
            !flock_is_held(&sidecar),
            "dropping the guards releases the sidecar flock"
        );
    }

    // ---- ensure_free_space (fs, tempfile) ----

    #[test]
    fn ensure_free_space_accepts_small_requests() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out.mp4");
        // 1 byte against a real (temp) filesystem with space available
        assert!(ensure_free_space(&target, 1).is_ok());
    }

    #[test]
    fn ensure_free_space_rejects_impossible_request() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out.mp4");
        // u64::MAX bytes can never fit; the guard must trip ERR::DISK_FULL
        assert_eq!(
            ensure_free_space(&target, u64::MAX),
            Err("ERR::DISK_FULL".to_string())
        );
    }

    // ---- cleanup_subtitle_files (fs, tempfile; promoted from ignored doctest) ----

    #[test]
    fn cleanup_subtitle_files_removes_only_matching_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let keep_video = dir.path().join("video.mp4");
        let keep_other_id = dir.path().join("temp_sub_other-id_en.srt");
        let drop_en = dir.path().join("temp_sub_dl-1_en.srt");
        let drop_ja = dir.path().join("temp_sub_dl-1_ja.srt");
        for p in [&keep_video, &keep_other_id, &drop_en, &drop_ja] {
            std::fs::write(p, b"x").unwrap();
        }

        cleanup_subtitle_files(dir.path(), "dl-1");

        assert!(keep_video.exists());
        assert!(keep_other_id.exists(), "other download ids untouched");
        assert!(!drop_en.exists());
        assert!(!drop_ja.exists());
        let subtitle_ass = dir.path().join("temp_sub_dl-1_zh.ass");
        std::fs::write(&subtitle_ass, b"s").unwrap();
    }

    #[test]
    fn cleanup_subtitle_files_missing_dir_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        // Must not panic on a nonexistent directory.
        cleanup_subtitle_files(&missing, "any");
    }

    // ---- BiliApi transport (wiremock) ----

    fn bili_api_mock(base: &str, cookie: &str) -> BiliApi {
        BiliApi::new(Client::new(), base, cookie)
    }

    #[tokio::test]
    async fn bili_api_sends_cookie_and_referer_headers() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0", "ttl": 1,
                    "data": { "isLogin": true, "mid": 42, "uname": "u",
                              "wbi_img": { "img_url": "i", "sub_url": "s" } }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "SESSDATA=abc");
        let body: UserApiResponse = api
            .get("/x/web-interface/nav")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(body.data.is_login);

        let req = &server.received_requests().await.unwrap()[0];
        assert_eq!(req.headers.get("cookie").unwrap(), "SESSDATA=abc");
        assert_eq!(req.headers.get("referer").unwrap(), REFERER);
    }

    #[tokio::test]
    async fn bili_api_omits_empty_cookie_header() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "message": "0", "data": null})),
            )
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let _: WebInterfaceApiResponse = api
            .get("/x/web-interface/view?bvid=x")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();

        let req = &server.received_requests().await.unwrap()[0];
        assert!(
            req.headers.get("cookie").is_none(),
            "logged-out requests must not carry an empty Cookie header"
        );
    }

    #[tokio::test]
    async fn bili_api_maps_429_to_rate_limited() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "SESSDATA=x");
        let err = api.get("/x/web-interface/nav").await.unwrap_err();
        assert_eq!(err, "ERR::RATE_LIMITED");
    }

    #[tokio::test]
    async fn bili_api_maps_server_error_to_api_error() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(502))
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let err = api.get("/x/web-interface/nav").await.unwrap_err();
        assert_eq!(err, "ERR::API_ERROR");
    }

    #[tokio::test]
    async fn bili_api_get_q_encodes_query_pairs() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::query_param("bvid", "BV1xx"))
            .and(wiremock::matchers::query_param("cid", "100"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "message": "0", "data": null})),
            )
            .expect(1)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "SESSDATA=x");
        let query = vec![
            ("bvid", "BV1xx".to_string()),
            ("cid", "100".to_string()),
            ("w_rid", "a b&c".to_string()), // URL-encoded by reqwest
        ];
        let _: XPlayerApiResponse = api
            .get_q("/x/player/wbi/playurl", &query)
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        server.verify().await;
    }

    #[tokio::test]
    async fn bili_api_validator_maps_unauthorized_code() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": -101, "message": "not logged in"})),
            )
            .mount(&server)
            .await;

        // Same transport shape fetch_video_title_by_bvid builds via
        // from_cookies; constructed manually so `base` targets the mock
        // server while the validator path stays under test.
        let api = BiliApi::new(Client::new(), server.uri(), "SESSDATA=stale");
        let body: WebInterfaceApiResponse = api
            .get("/x/web-interface/wbi/view?bvid=x")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(
            validate_api_response(body.code, body.data.as_ref()),
            Err("ERR::UNAUTHORIZED".to_string())
        );
    }

    // ---- fetch_wbi_view (shared by metadata / history view fetches) ----

    /// Nav mock body serving a fixed wbi_img (anonymous shape: code -101
    /// still carries the key URLs).
    fn nav_wbi_mock_body() -> serde_json::Value {
        serde_json::json!({
            "code": -101, "message": "account not logged in",
            "data": {
                "wbi_img": {
                    "img_url": "https://mockHost/hello-world-img_key.png",
                    "sub_url": "https://mockHost/hello-world-sub_key.png"
                }
            }
        })
    }

    #[test]
    fn wbi_video_param_maps_av_ids_to_aid() {
        assert_eq!(
            wbi_video_param("av116141485850794"),
            ("aid", "116141485850794".to_string())
        );
        assert_eq!(
            wbi_video_param("BV1FV411d7u7"),
            ("bvid", "BV1FV411d7u7".to_string())
        );
        // Non-numeric / empty suffixes are not av ids — they must stay on
        // the bvid param rather than send a garbage aid.
        assert_eq!(wbi_video_param("av"), ("bvid", "av".to_string()));
        assert_eq!(wbi_video_param("avx1"), ("bvid", "avx1".to_string()));
    }

    #[test]
    fn canonical_video_id_prefers_api_bvid_for_av_lookups() {
        assert_eq!(canonical_video_id("av123", "BV1real"), "BV1real");
        // BV requests keep the requested id even if the API echoes another
        assert_eq!(canonical_video_id("BV1req", "BV1api"), "BV1req");
    }

    #[tokio::test]
    async fn fetch_wbi_view_av_id_queries_aid_param() {
        // Regression: an av-URL id was sent as `bvid=av…` and rejected with
        // ERR::API_ERROR (real-world av URL, found during manual testing).
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        // Matches ONLY the aid param; a wrong `bvid=av…` request 404s.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .and(wiremock::matchers::query_param("aid", "116141485850794"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "bvid": "BV1real", "title": "av video", "pic": "p",
                        "cid": 1, "pages": []
                    }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let body = fetch_wbi_view(&api, "av116141485850794").await.unwrap();
        let data = body.data.unwrap();
        assert_eq!(data.bvid, "BV1real");
        assert_eq!(data.title, "av video");
    }

    #[tokio::test]
    async fn fetch_wbi_view_works_logged_out() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .expect(1)
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .and(wiremock::matchers::query_param("bvid", "BV1guest"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "title": "guest video", "pic": "p", "cid": 1, "pages": [] }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        // Empty cookie header = logged out (the reported bug scenario).
        let api = bili_api_mock(&server.uri(), "");
        let body = fetch_wbi_view(&api, "BV1guest").await.unwrap();
        assert_eq!(body.data.unwrap().title, "guest video");

        let requests = server.received_requests().await.unwrap();
        let view_req = requests
            .iter()
            .find(|r| r.url.path() == "/x/web-interface/wbi/view")
            .expect("wbi/view request");
        assert!(
            view_req.headers.get("cookie").is_none(),
            "logged-out view request must not carry a Cookie header"
        );
        // w_rid / wts presence is asserted via the query string (wiremock
        // 0.6 has no param-exists matcher and w_rid is a dynamic digest).
        let query = view_req.url.query().unwrap_or_default();
        assert!(query.contains("w_rid="), "query missing w_rid: {query}");
        // Why: exactly one wts pair — generate_wbi_signature already inserts
        // wts into `params` (src-tauri/src/utils/wbi.rs), so an extra
        // query.push would put the pair on the wire twice; wbi endpoints
        // return v_voucher when wts/w_rid are missing or wrong
        // (references/bilibili-API-collect/docs/misc/sign/wbi.md)
        assert_eq!(
            query.split('&').filter(|p| p.starts_with("wts=")).count(),
            1,
            "wts pair must appear exactly once (0 = missing, 2 = duplicated): {query}"
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn fetch_wbi_view_sends_cookie_when_logged_in() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "title": "t", "pic": "p", "cid": 1, "pages": [] }
                })),
            )
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "SESSDATA=abc");
        let body = fetch_wbi_view(&api, "BV1user").await.unwrap();
        assert_eq!(body.data.unwrap().title, "t");

        let requests = server.received_requests().await.unwrap();
        let view_req = requests
            .iter()
            .find(|r| r.url.path() == "/x/web-interface/wbi/view")
            .expect("wbi/view request");
        assert_eq!(view_req.headers.get("cookie").unwrap(), "SESSDATA=abc");
    }

    // ---- get_preview_play_url (search-result MP4 preview) ----

    #[tokio::test]
    async fn get_preview_play_url_resolves_html5_mp4_durl() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .and(wiremock::matchers::query_param("bvid", "BV1preview"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "bvid": "BV1preview", "title": "t", "pic": "p",
                              "cid": 77, "pages": [] }
                })),
            )
            .mount(&server)
            .await;
        // Matches ONLY the html5 preview shape: a DASH-shaped request
        // (fnval=16, no platform param) 404s, pinning the wire format.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .and(wiremock::matchers::query_param("cid", "77"))
            .and(wiremock::matchers::query_param("platform", "html5"))
            .and(wiremock::matchers::query_param("high_quality", "1"))
            .and(wiremock::matchers::query_param("try_look", "1"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "durl": [
                            { "order": 1, "length": 1, "size": 1,
                              "url": "https://example.com/preview.mp4" }
                        ]
                    }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        // Logged out (empty cookie): the preview must work for guests.
        let api = bili_api_mock(&server.uri(), "");
        let url = get_preview_play_url_with(&api, "BV1preview").await.unwrap();
        assert_eq!(url, "https://example.com/preview.mp4");
        server.verify().await;
    }

    #[tokio::test]
    async fn get_preview_play_url_upgrades_http_durl_to_https() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .and(wiremock::matchers::query_param("bvid", "BV1httppreview"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "bvid": "BV1httppreview", "title": "t", "pic": "p",
                              "cid": 78, "pages": [] }
                })),
            )
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "durl": [
                            { "order": 1, "length": 1, "size": 1,
                              "url": "http://example.com/preview.mp4" }
                        ]
                    }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let url = get_preview_play_url_with(&api, "BV1httppreview")
            .await
            .unwrap();
        assert_eq!(url, "https://example.com/preview.mp4");
        server.verify().await;
    }

    #[tokio::test]
    async fn get_preview_play_url_maps_missing_stream() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "bvid": "BV1nostream", "title": "t", "pic": "p",
                              "cid": 5, "pages": [] }
                })),
            )
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "code": 0, "message": "0", "data": {} })),
            )
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let err = get_preview_play_url_with(&api, "BV1nostream")
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::NO_STREAM");
    }

    #[tokio::test]
    async fn get_preview_play_url_rerolls_akamai_mirror_host() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "bvid": "BV1akamai", "title": "t", "pic": "p",
                              "cid": 9, "pages": [] }
                })),
            )
            .mount(&server)
            .await;
        // First playurl response hands out the Akamai mirror (WKWebView h3
        // playback risk) — consumed once, then the bilivideo mock takes over.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .and(wiremock::matchers::query_param("cid", "9"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "durl": [
                            { "order": 1, "length": 1, "size": 1,
                              "url": "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/9.mp4" }
                        ]
                    }
                })),
            )
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .and(wiremock::matchers::query_param("cid", "9"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "durl": [
                            { "order": 1, "length": 1, "size": 1,
                              "url": "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/9.mp4" }
                        ]
                    }
                })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let url = get_preview_play_url_with(&api, "BV1akamai").await.unwrap();
        assert_eq!(
            url,
            "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/9.mp4"
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn get_preview_play_url_falls_back_to_akamai_when_host_never_rotates() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": { "bvid": "BV1stuck", "title": "t", "pic": "p",
                              "cid": 4, "pages": [] }
                })),
            )
            .mount(&server)
            .await;
        // Akamai-only pool: bounded retries (3 calls) then return the URL
        // rather than failing the preview.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/player/wbi/playurl"))
            .and(wiremock::matchers::query_param("cid", "4"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0",
                    "data": {
                        "durl": [
                            { "order": 1, "length": 1, "size": 1,
                              "url": "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/4.mp4" }
                        ]
                    }
                })),
            )
            .expect(PREVIEW_PLAYURL_MAX_ATTEMPTS as u64)
            .mount(&server)
            .await;

        let api = bili_api_mock(&server.uri(), "");
        let url = get_preview_play_url_with(&api, "BV1stuck").await.unwrap();
        assert_eq!(
            url,
            "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/4.mp4"
        );
        server.verify().await;
    }

    // ---- search_videos (keyword video search) ----

    #[test]
    fn strip_keyword_em_tags_removes_highlights() {
        assert_eq!(
            strip_keyword_em_tags("梦然-《<em class=\"keyword\">少年</em>》官方版"),
            "梦然-《少年》官方版"
        );
        // Bare <em> variant seen on some responses
        assert_eq!(strip_keyword_em_tags("<em>少年</em>"), "少年");
        assert_eq!(strip_keyword_em_tags("no tags"), "no tags");
    }

    #[test]
    fn normalize_cover_url_prepends_https() {
        assert_eq!(
            normalize_cover_url("//i0.hdslb.com/bfs/archive/x.jpg"),
            "https://i0.hdslb.com/bfs/archive/x.jpg"
        );
        assert_eq!(
            normalize_cover_url("https://i0.hdslb.com/bfs/archive/x.jpg"),
            "https://i0.hdslb.com/bfs/archive/x.jpg"
        );
    }

    #[test]
    fn duration_seconds_accepts_string_and_number_shapes() {
        use serde_json::Value;
        // Live-API string shapes ("m:ss", minutes > 99, empty)
        assert_eq!(duration_seconds(Some(&Value::String("4:47".into()))), 287);
        assert_eq!(
            duration_seconds(Some(&Value::String("186:34".into()))),
            11194
        );
        assert_eq!(
            duration_seconds(Some(&Value::String("1:01:01".into()))),
            3661
        );
        assert_eq!(duration_seconds(Some(&Value::String(String::new()))), 0);
        // Reference-doc integer shape
        assert_eq!(duration_seconds(Some(&Value::Number(287.into()))), 287);
        // Hostile/huge wire value saturates instead of panicking
        assert_eq!(
            duration_seconds(Some(&Value::String("9223372036854775807:01:01".into()))),
            i64::MAX
        );
        // Absent / null
        assert_eq!(duration_seconds(None), 0);
        assert_eq!(duration_seconds(Some(&Value::Null)), 0);
    }

    #[test]
    fn unescape_title_entities_decodes_live_api_samples() {
        // Samples observed on the live API (keyword "mrs.", 2026-10-01)
        assert_eq!(
            unescape_title_entities("Mrs. Kelly&#x27;s Class"),
            "Mrs. Kelly's Class"
        );
        assert_eq!(
            unescape_title_entities("Mr. &amp; Mrs. Smith"),
            "Mr. & Mrs. Smith"
        );
        // Numeric decimal + named entities, and text without entities
        assert_eq!(unescape_title_entities("a&quot;b"), "a\"b");
        assert_eq!(unescape_title_entities("&#21490;蜜"), "史蜜");
        assert_eq!(unescape_title_entities("plain title"), "plain title");
        // Unknown entity and bare ampersand stay untouched
        assert_eq!(unescape_title_entities("a &unknown; b"), "a &unknown; b");
        assert_eq!(unescape_title_entities("AT&T"), "AT&T");
    }

    /// Wiremock body for a successful `search_type=video` page-1 response.
    ///
    /// Field shapes mirror the LIVE API (probed 2026-10-01): duration is a
    /// "m:ss" string, and the list can interleave ad rows with an empty
    /// bvid — both differ from the reference doc example.
    fn search_ok_body() -> serde_json::Value {
        serde_json::json!({
            "code": 0, "message": "OK",
            "data": {
                "seid": "s", "page": 1, "pagesize": 20,
                "numResults": 1000, "numPages": 50,
                "result": [
                    {
                        "type": "video", "id": 1, "author": "up主",
                        "mid": 1, "typeid": "193", "typename": "MV",
                        "arcurl": "http://www.bilibili.com/video/av1",
                        "aid": 1, "bvid": "BV1De411p77r",
                        "title": "梦然-《<em class=\"keyword\">少年</em>》官方版&amp;MV",
                        "description": "d", "pic": "//i0.hdslb.com/bfs/archive/x.jpg",
                        "play": 1037655, "video_review": 2616, "favorites": 27341,
                        "tag": "t", "review": 1265, "pubdate": 1590000000,
                        "senddate": 1590000000, "duration": "4:47",
                        "arcrank": "0"
                    },
                    {
                        // Ad/interference row observed on the live API:
                        // empty bvid (and empty duration) — must be filtered.
                        "type": "video", "author": "ad",
                        "bvid": "", "title": "ad row",
                        "pic": "https://archive.biliimg.com/bfs/archive/ad.jpg",
                        "play": 2550, "duration": ""
                    }
                ]
            }
        })
    }

    /// Mounts the nav mock (mixin key source) on `server`.
    async fn mount_nav_mock(server: &wiremock::MockServer) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(nav_wbi_mock_body()))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn search_videos_with_parses_and_normalizes_entries() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .and(wiremock::matchers::query_param("search_type", "video"))
            // Reserved chars must round-trip through the WBI-signed query.
            .and(wiremock::matchers::query_param("keyword", "a & b"))
            .and(wiremock::matchers::header("Cookie", "buvid3=xyz"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(search_ok_body()))
            .mount(&server)
            .await;

        let res = search_videos_with(
            &bili_api_mock(&server.uri(), "buvid3=xyz"),
            "a & b",
            1,
            None,
        )
        .await
        .unwrap();

        assert_eq!(res.page, 1);
        assert_eq!(res.num_results, 1000);
        assert_eq!(res.num_pages, 50);
        assert_eq!(res.entries.len(), 1);
        let e = &res.entries[0];
        assert_eq!(e.bvid, "BV1De411p77r");
        assert_eq!(e.title, "梦然-《少年》官方版&MV");
        assert_eq!(e.cover, "https://i0.hdslb.com/bfs/archive/x.jpg");
        assert_eq!(e.author, "up主");
        assert_eq!(e.play, 1037655);
        assert_eq!(e.duration, 287, "\"4:47\" string normalized to seconds");
        assert_eq!(e.typeid, "193");
        assert_eq!(e.typename, "MV");
    }

    #[tokio::test]
    async fn search_videos_with_applies_filters_to_the_signed_query() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        // The mock only answers when the filter params ride the query, so
        // a missing/mis-signed param fails the request (404 → Err).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .and(wiremock::matchers::query_param("order", "click"))
            .and(wiremock::matchers::query_param("duration", "2"))
            .and(wiremock::matchers::query_param("tids", "4"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(search_ok_body()))
            .mount(&server)
            .await;

        let filters = SearchFilters {
            order: Some("click".into()),
            duration: Some(2),
            tids: Some(4),
        };
        let res = search_videos_with(
            &bili_api_mock(&server.uri(), "buvid3=xyz"),
            "kw",
            1,
            Some(&filters),
        )
        .await
        .unwrap();
        assert_eq!(res.entries.len(), 1);
    }

    #[tokio::test]
    async fn search_videos_with_normalizes_invalid_filters_to_defaults() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        // Unknown order / out-of-range duration / negative tids must land
        // on the documented defaults (totalrank / clamp to 4 / 0).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .and(wiremock::matchers::query_param("order", "totalrank"))
            .and(wiremock::matchers::query_param("duration", "4"))
            .and(wiremock::matchers::query_param("tids", "0"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(search_ok_body()))
            .mount(&server)
            .await;

        let filters = SearchFilters {
            order: Some("DROP TABLE videos".into()),
            duration: Some(9),
            tids: Some(-3),
        };
        search_videos_with(
            &bili_api_mock(&server.uri(), "buvid3=xyz"),
            "kw",
            1,
            Some(&filters),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn search_videos_with_maps_412_to_rate_limited() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": -412, "message": "request blocked"})),
            )
            .mount(&server)
            .await;

        let err = search_videos_with(&bili_api_mock(&server.uri(), "buvid3=xyz"), "kw", 1, None)
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::RATE_LIMITED");
    }

    #[tokio::test]
    async fn search_videos_with_maps_nonzero_api_error() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": -400, "message": "bad request"})),
            )
            .mount(&server)
            .await;

        let err = search_videos_with(&bili_api_mock(&server.uri(), "buvid3=xyz"), "kw", 1, None)
            .await
            .unwrap_err();
        assert!(err.contains("-400"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn search_videos_with_accepts_empty_results() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "message": "0",
                    "data": {"page": 2, "numResults": 0, "numPages": 1, "result": []}})),
            )
            .mount(&server)
            .await;

        let res = search_videos_with(&bili_api_mock(&server.uri(), "buvid3=xyz"), "kw", 2, None)
            .await
            .unwrap();
        assert!(res.entries.is_empty());
        assert_eq!(res.num_results, 0);
    }

    #[tokio::test]
    async fn search_videos_with_degrades_code0_missing_data_to_empty_page() {
        // Some code-0 responses omit `data` entirely; the page must degrade
        // to "no results" instead of erroring the whole search screen.
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "message": "0"})),
            )
            .mount(&server)
            .await;

        let res = search_videos_with(&bili_api_mock(&server.uri(), "buvid3=xyz"), "kw", 1, None)
            .await
            .unwrap();
        assert!(res.entries.is_empty());
        assert_eq!(res.num_results, 0);
        assert_eq!(res.num_pages, 0);
        // The clamped requested page is echoed back, not the absent one.
        assert_eq!(res.page, 1);
    }

    #[tokio::test]
    async fn search_suggest_with_returns_keyword_values() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/main/suggest"))
            .and(wiremock::matchers::query_param("term", "ショタ"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(
                serde_json::json!({
                    "code": 0, "exp_str": "",
                    "result": {"tag": [
                        {"value": "ショタ", "ref": 0, "name": "<em class=\"suggest_high_light\">ショタ</em>", "spid": 5, "type": ""},
                        {"value": "おねショタ", "ref": 0, "name": "おね<em class=\"suggest_high_light\">ショタ</em>", "spid": 5, "type": ""}
                    ]},
                    "stoken": ""
                }),
            ))
            .mount(&server)
            .await;

        let values = search_suggest_with(&bili_api_mock(&server.uri(), ""), "ショタ")
            .await
            .unwrap();
        assert_eq!(values, vec!["ショタ".to_string(), "おねショタ".to_string()]);
    }

    #[tokio::test]
    async fn search_suggest_with_degrades_transport_and_api_errors_to_empty() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/main/suggest"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;

        // Transport failure → empty, not an error (mid-typing must never
        // surface an error).
        let values = search_suggest_with(&bili_api_mock(&server.uri(), ""), "kw")
            .await
            .unwrap();
        assert!(values.is_empty());

        // API-level non-zero code → empty as well.
        let server2 = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/main/suggest"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": -1, "result": null})),
            )
            .mount(&server2)
            .await;
        let values = search_suggest_with(&bili_api_mock(&server2.uri(), ""), "kw")
            .await
            .unwrap();
        assert!(values.is_empty());
    }

    #[tokio::test]
    async fn search_trending_with_parses_keywords_and_falls_back_show_name() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/search/square",
            ))
            .and(wiremock::matchers::query_param("limit", "10"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "OK",
                    "data": {"trending": {"title": "bilibili热搜", "list": [
                        {"keyword": "KPL", "show_name": "北京JDG vs 杭州LGD KPL"},
                        {"keyword": "no_display"}
                    ]}}
                })),
            )
            .mount(&server)
            .await;

        let out = search_trending_with(&bili_api_mock(&server.uri(), ""))
            .await
            .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].keyword, "KPL");
        assert_eq!(out[0].show_name, "北京JDG vs 杭州LGD KPL");
        // Missing show_name falls back to the keyword itself.
        assert_eq!(out[1].show_name, "no_display");
    }

    #[tokio::test]
    async fn search_trending_with_degrades_transport_and_api_errors_to_empty() {
        // Nav answers (mixin key resolves) but square 500s → empty, no error.
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/search/square",
            ))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;
        assert!(search_trending_with(&bili_api_mock(&server.uri(), ""))
            .await
            .unwrap()
            .is_empty());

        // API-level non-zero code → empty as well.
        let server2 = wiremock::MockServer::start().await;
        mount_nav_mock(&server2).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/search/square",
            ))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": -400, "message": "err"})),
            )
            .mount(&server2)
            .await;
        assert!(search_trending_with(&bili_api_mock(&server2.uri(), ""))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn search_trending_with_degrades_code0_missing_data_to_empty() {
        // code 0 but no `data` at all → empty, not an error (same degrade
        // as search_videos_with_degrades_code0_missing_data_to_empty).
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/search/square",
            ))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "message": "0"})),
            )
            .mount(&server)
            .await;
        assert!(search_trending_with(&bili_api_mock(&server.uri(), ""))
            .await
            .unwrap()
            .is_empty());

        // `data` present but no `trending` key → empty as well.
        let server2 = wiremock::MockServer::start().await;
        mount_nav_mock(&server2).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/search/square",
            ))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"code": 0, "data": {}})),
            )
            .mount(&server2)
            .await;
        assert!(search_trending_with(&bili_api_mock(&server2.uri(), ""))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn search_trending_with_degrades_mixin_key_failure_to_empty() {
        // No nav mock mounted: fetch_mixin_key fails → the panel degrades
        // to an empty list, never an error (best-effort panel).
        let server = wiremock::MockServer::start().await;
        assert!(search_trending_with(&bili_api_mock(&server.uri(), ""))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn search_videos_with_clamps_page_to_one() {
        // The seam clamps page < 1 to 1 BEFORE the request; the mock only
        // answers `page=1`, so an unclamped `page=0` would 404 → ERR::API_ERROR.
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/search/type"))
            .and(wiremock::matchers::query_param("page", "1"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(search_ok_body()))
            .mount(&server)
            .await;

        let res = search_videos_with(&bili_api_mock(&server.uri(), "buvid3=xyz"), "kw", 0, None)
            .await
            .unwrap();
        assert_eq!(res.page, 1);
    }

    #[test]
    fn curl_args_shape_uses_app_headers_and_bounds() {
        let args = curl_args("https://api.bilibili.com/x?k=v", "buvid3=b3");
        assert_eq!(args[0], "-sS");
        assert_eq!(args[1], "--max-time");
        assert_eq!(args[2], "15");
        assert!(args.contains(&format!("User-Agent: {USER_AGENT}")));
        assert!(args.contains(&"Referer: https://www.bilibili.com".to_string()));
        assert!(args.contains(&"Cookie: buvid3=b3".to_string()));
        assert_eq!(*args.last().unwrap(), "https://api.bilibili.com/x?k=v");

        // Empty cookie → the Cookie header must be OMITTED (an empty
        // `Cookie:` header is a script fingerprint; see curl_args).
        let bare = curl_args("https://api.bilibili.com/nav", "");
        assert!(!bare.iter().any(|a| a.starts_with("Cookie:")));
    }

    #[test]
    fn parse_search_response_maps_codes_and_entries() {
        let ok = parse_search_response(&search_ok_body().to_string(), 1).unwrap();
        assert_eq!(ok.entries.len(), 1, "ad row filtered");
        assert_eq!(ok.entries[0].typeid, "193");

        let err = parse_search_response(r#"{"code":-412,"message":"blocked"}"#, 1).unwrap_err();
        assert_eq!(err, "ERR::RATE_LIMITED");

        let err = parse_search_response(r#"{"code":-400,"message":"bad"}"#, 1).unwrap_err();
        assert!(err.contains("-400"));

        // code-0 without data degrades to an empty page at the clamped page.
        let empty = parse_search_response(r#"{"code":0,"message":"0"}"#, 0).unwrap();
        assert_eq!(empty.page, 1);
        assert_eq!(empty.entries.len(), 0);
    }

    #[test]
    fn parse_popular_response_maps_entries_and_pagination() {
        let body = serde_json::json!({
            "code": 0,
            "message": "0",
            "data": {
                "list": [
                    {
                        "bvid": "BV1xx411c7mD",
                        "title": "Popular title",
                        "pic": "//i0.hdslb.com/bfs/archive/p.jpg",
                        "owner": { "name": "up" },
                        "stat": { "view": 2465053 },
                        "duration": 138,
                        "tid": 250,
                        "tname": "出行"
                    },
                    // Ad/interference row: empty bvid is filtered out.
                    { "bvid": "", "title": "ad" }
                ],
                "no_more": false
            }
        });

        let ok = parse_popular_response(&body.to_string(), 2).unwrap();
        assert_eq!(ok.page, 2);
        assert_eq!(ok.num_results, 0, "feed reports no total (chip hidden)");
        assert_eq!(ok.num_pages, 3, "no_more=false synthesizes a next page");
        assert_eq!(ok.entries.len(), 1, "empty-bvid row filtered");
        let e = &ok.entries[0];
        assert_eq!(e.title, "Popular title");
        assert_eq!(e.cover, "https://i0.hdslb.com/bfs/archive/p.jpg");
        assert_eq!(e.author, "up");
        assert_eq!(e.play, 2465053);
        assert_eq!(e.duration, 138, "popular duration is already seconds");
        assert_eq!(e.typeid, "250");
        assert_eq!(e.typename, "出行");

        let last = parse_popular_response(
            r#"{"code":0,"message":"0","data":{"list":[],"no_more":true}}"#,
            5,
        )
        .unwrap();
        assert_eq!(
            last.num_pages, 5,
            "no_more=true caps pagination at the current page"
        );
        assert_eq!(last.entries.len(), 0);
    }

    #[test]
    fn parse_popular_response_maps_error_codes() {
        let err = parse_popular_response(r#"{"code":-412,"message":"blocked"}"#, 1).unwrap_err();
        assert_eq!(err, "ERR::RATE_LIMITED");

        let err = parse_popular_response(r#"{"code":-400,"message":"bad"}"#, 1).unwrap_err();
        assert!(err.contains("-400"));

        // code-0 without data degrades to an empty page; no_more defaults
        // false so a next page is still advertised.
        let empty = parse_popular_response(r#"{"code":0,"message":"0"}"#, 1).unwrap();
        assert_eq!(empty.entries.len(), 0);
        assert_eq!(empty.num_pages, 2);
    }

    #[tokio::test]
    async fn fetch_popular_videos_with_clamps_page_and_sends_params() {
        let server = wiremock::MockServer::start().await;
        // Plain GET (no nav/WBI mock needed, unlike the search tests): the
        // mock only answers when the page params ride the query, so a
        // missing param fails the request (404 → Err).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/popular"))
            .and(wiremock::matchers::query_param("ps", "20"))
            .and(wiremock::matchers::query_param("pn", "1"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"code": 0, "message": "0", "data": {"list": [
                    {"bvid": "BV1xx411c7mD", "title": "t", "pic": "", "owner": {"name": "up"},
                     "stat": {"view": 1}, "duration": 60, "tid": 1, "tname": "z"}
                ], "no_more": true}}),
            ))
            .mount(&server)
            .await;

        let res = fetch_popular_videos_with(&bili_api_mock(&server.uri(), ""), 0)
            .await
            .unwrap();
        assert_eq!(res.page, 1, "page clamped to 1");
        assert_eq!(res.num_pages, 1, "no_more=true caps at the current page");
        assert_eq!(res.entries.len(), 1);
    }

    fn home_feed_body() -> serde_json::Value {
        serde_json::json!({"code": 0, "message": "0", "data": {"item": [
            {"goto": "av", "bvid": "BV1rec0", "title": "Rec 0",
             "pic": "http://i0.hdslb.com/bfs/a.jpg", "duration": 100,
             "owner": {"name": "up0"}, "stat": {"view": 1000},
             "rcmd_reason": {"content": "高点赞量"}},
            {"goto": "av", "bvid": "BV1rec1", "title": "Rec 1",
             "pic": "http://i0.hdslb.com/bfs/b.jpg", "duration": 200,
             "owner": {"name": "up1"}, "stat": {"view": 2000}},
            {"goto": "live", "id": 123},
            {"goto": "ogv"},
            {"goto": "av", "bvid": "BV1ad", "title": "Ad",
             "business_info": {"archive": {}}},
            {"goto": "av", "bvid": "BV1rec2", "title": "Rec 2",
             "pic": "https://i0.hdslb.com/bfs/c.jpg", "duration": 300,
             "owner": {"name": "up2"}, "stat": {"view": 3000},
             "rcmd_reason": {"content": ""}}
        ]}})
    }

    #[tokio::test]
    async fn fetch_home_recommendations_with_maps_av_rows_and_drops_mixins() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/index/top/feed/rcmd",
            ))
            .and(wiremock::matchers::query_param("ps", "12"))
            .and(wiremock::matchers::header("Cookie", "SESSDATA=x; buvid3=b"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(home_feed_body()))
            .mount(&server)
            .await;

        let res =
            fetch_home_recommendations_with(&bili_api_mock(&server.uri(), "SESSDATA=x; buvid3=b"))
                .await
                .unwrap();

        // live/ogv rows and the business_info ad row are dropped.
        assert_eq!(res.len(), 3);
        assert_eq!(res[0].bvid, "BV1rec0");
        // Same normalization contract as the popular feed: "//" covers get
        // https prepended; absolute http URLs pass through unchanged.
        assert_eq!(res[0].cover, "http://i0.hdslb.com/bfs/a.jpg");
        assert_eq!(res[2].cover, "https://i0.hdslb.com/bfs/c.jpg");
        assert_eq!(res[0].recommend_reason.as_deref(), Some("高点赞量"));
        // No rcmd_reason → None; empty reason content → None (no empty chip).
        assert_eq!(res[1].recommend_reason, None);
        assert_eq!(res[2].recommend_reason, None);
        // feed/rcmd carries no zone info — ZoneBadge stays hidden.
        assert!(res[0].typeid.is_empty() && res[0].typename.is_empty());
    }

    #[test]
    fn parse_home_feed_response_maps_error_codes() {
        let err = parse_home_feed_response(r#"{"code":-352,"message":"risk"}"#).unwrap_err();
        assert!(err.contains("-352"));
        // code-0 without data degrades to an empty shelf.
        let empty = parse_home_feed_response(r#"{"code":0,"message":"0"}"#).unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn parse_home_feed_response_caps_at_twelve_av_rows() {
        let items: Vec<_> = (0..15)
            .map(|i| {
                serde_json::json!({"goto": "av", "bvid": format!("BV1rec{i}"),
                    "title": format!("Rec {i}"), "pic": "", "duration": i,
                    "owner": {"name": "up"}, "stat": {"view": i}})
            })
            .collect();
        let body = serde_json::json!({"code": 0, "message": "0", "data": {"item": items}});
        let res = parse_home_feed_response(&body.to_string()).unwrap();
        // Featured grid contract: ps=12 fills the shelf once — extra rows
        // (server may return more) are truncated, not spilled.
        assert_eq!(res.len(), 12);
        assert_eq!(res.last().unwrap().bvid, "BV1rec11");
    }

    #[tokio::test]
    async fn fetch_home_recommendations_with_errors_on_http_failure() {
        let server = wiremock::MockServer::start().await;
        mount_nav_mock(&server).await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(
                "/x/web-interface/wbi/index/top/feed/rcmd",
            ))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;

        // Transport-level failure surfaces as Err from the seam (the
        // AppHandle wrapper degrades it to an empty shelf).
        let err = fetch_home_recommendations_with(&bili_api_mock(&server.uri(), "SESSDATA=x"))
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::API_ERROR");
    }

    /// Canned transport for the anonymous-search seam: serves spi/nav
    /// fixtures and a scripted sequence of search bodies, recording the
    /// cookie each search URL was fetched with. Single-threaded test
    /// runtime → RefCell state, no locking.
    struct AnonMock {
        search_bodies: Vec<String>,
        calls: std::cell::Cell<usize>,
        search_cookies: std::cell::RefCell<Vec<String>>,
    }

    impl AnonMock {
        fn new(search_bodies: Vec<String>) -> Self {
            Self {
                search_bodies,
                calls: std::cell::Cell::new(0),
                search_cookies: std::cell::RefCell::new(Vec::new()),
            }
        }

        /// Decides synchronously and returns an OWNED future (no self
        /// borrow escapes) so the closure satisfies the seam's
        /// higher-ranked bound.
        fn fetch(
            &self,
            url: &str,
            cookie: &str,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
            let out = if url.ends_with("/x/frontend/finger/spi") {
                // Fresh device id per call: the retry must switch buvid3.
                let calls = self.calls.get();
                Ok(
                    serde_json::json!({"code": 0, "data": {"b_3": format!("b3-{calls}")}})
                        .to_string(),
                )
            } else if url.ends_with("/x/web-interface/nav") {
                Ok(nav_wbi_mock_body().to_string())
            } else {
                let calls = self.calls.get();
                self.calls.set(calls + 1);
                self.search_cookies.borrow_mut().push(cookie.to_string());
                let idx = calls.min(self.search_bodies.len() - 1);
                Ok(self.search_bodies[idx].clone())
            };
            Box::pin(async move { out })
        }
    }

    fn anon_voucher_body() -> String {
        serde_json::json!({"code": 0, "message": "OK", "data": {"v_voucher": "voucher-x"}})
            .to_string()
    }

    #[tokio::test]
    async fn search_videos_anon_retries_v_voucher_with_fresh_buvid3() {
        let mock = AnonMock::new(vec![anon_voucher_body(), search_ok_body().to_string()]);

        let resp = search_videos_anon_with(
            |u, c| mock.fetch(u, c),
            "https://api.bilibili.com",
            "kw",
            1,
            None,
        )
        .await
        .unwrap()
        .expect("transport available");

        assert_eq!(resp.entries.len(), 1, "second attempt wins");
        let cookies = mock.search_cookies.borrow().clone();
        assert_eq!(cookies.len(), 2, "search fetched exactly twice");
        assert_ne!(cookies[0], cookies[1], "retry switched to a fresh buvid3");
        assert!(cookies[1].starts_with("buvid3=b3-"), "{cookies:?}");
    }

    #[tokio::test]
    async fn search_videos_anon_returns_last_degraded_response_after_retries() {
        let mock = AnonMock::new(vec![anon_voucher_body()]);

        let resp = search_videos_anon_with(
            |u, c| mock.fetch(u, c),
            "https://api.bilibili.com",
            "kw",
            1,
            None,
        )
        .await
        .unwrap()
        .expect("transport available");

        assert_eq!(resp.page, 0, "degraded body surfaces after 3 attempts");
        assert_eq!(mock.search_cookies.borrow().len(), 3);
    }

    #[tokio::test]
    async fn search_videos_anon_signals_fallback_when_transport_fails() {
        let out = search_videos_anon_with(
            |_u, _c| Box::pin(async { Err("failed to spawn curl".to_string()) }),
            "https://api.bilibili.com",
            "kw",
            1,
            None,
        )
        .await
        .unwrap();
        assert!(out.is_none(), "None tells the caller to fall back");
    }

    #[tokio::test]
    async fn expand_short_url_follows_redirect_chain() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::path("/short"))
            .respond_with(
                wiremock::ResponseTemplate::new(302)
                    .insert_header("Location", &format!("{}/video/BV1final", server.uri())),
            )
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::path("/video/BV1final"))
            .respond_with(wiremock::ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap();
        let expanded = expand_short_url_with(client, format!("{}/short", server.uri()))
            .await
            .unwrap();
        assert!(expanded.ends_with("/video/BV1final"), "{expanded}");
    }

    // ---- web_interface_data_to_video ----

    use crate::models::bilibili_api::WebInterfaceApiResponsePage;

    fn view_data(
        title: &str,
        pic: &str,
        cid: i64,
        pages: Option<Vec<WebInterfaceApiResponsePage>>,
    ) -> WebInterfaceApiResponseData {
        WebInterfaceApiResponseData {
            bvid: "BV1test".into(),
            title: title.into(),
            pic: pic.into(),
            cid,
            pages,
            redirect_url: None,
        }
    }

    fn page(cid: i64, page: i32, part: &str, duration: i64) -> WebInterfaceApiResponsePage {
        WebInterfaceApiResponsePage {
            cid,
            page,
            part: part.into(),
            duration,
            first_frame: None,
        }
    }

    #[test]
    fn web_interface_data_to_video_single_part_falls_back_to_title() {
        let data = view_data("Main Title", "http://pic", 7, Some(vec![]));
        let video = web_interface_data_to_video(&data, "BV1x", None, false, true, true);
        assert_eq!(video.parts.len(), 1);
        assert_eq!(video.parts[0].cid, 7);
        assert_eq!(video.parts[0].part, "Main Title");
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("Main Title"));
        assert_eq!(video.parts[0].default_title, "Main Title");
        assert_eq!(video.parts[0].thumbnail.url, "http://pic");
        assert!(video.is_limited_quality);
        assert_eq!(video.content_type, "video");
    }

    #[test]
    fn web_interface_data_to_video_multi_part_names_and_thumbs() {
        let pages = vec![
            page(1, 1, "Part A", 60),
            page(2, 2, "", 30), // empty part name -> main title; no first_frame -> pic
        ];
        let data = view_data("T", "http://pic", 0, Some(pages));
        let video = web_interface_data_to_video(&data, "BV1x", None, false, true, false);
        assert_eq!(video.parts.len(), 2);
        assert_eq!(video.parts[0].part, "Part A");
        assert_eq!(video.parts[0].default_title, "T Part A");
        // Empty part name falls back to the title, which then gets omitted
        assert_eq!(video.parts[1].part, "T");
        assert_eq!(video.parts[1].default_title, "T");
        assert_eq!(video.parts[1].thumbnail.url, "http://pic");
        assert_eq!(video.parts[1].duration, 30);
    }

    #[test]
    fn web_interface_data_to_video_resolves_duplicate_sanitized_names() {
        let pages = vec![page(1, 1, "same", 1), page(2, 2, "same", 1)];
        let data = view_data("T", "p", 0, Some(pages));
        let video = web_interface_data_to_video(&data, "BV1x", None, true, true, false);
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("same"));
        assert_eq!(video.parts[1].sanitized_part.as_deref(), Some("same (1)"));
        // Suffix from duplicate resolution breaks the title match, so both combine
        assert_eq!(video.parts[0].default_title, "T same");
        assert_eq!(video.parts[1].default_title, "T same (1)");
    }

    #[test]
    fn web_interface_data_to_video_applies_title_replacements() {
        use crate::models::settings::TitleReplacement;
        let data = view_data("a:b", "p", 1, Some(vec![]));
        let rules = [TitleReplacement::new(":", "_", true)];
        let video = web_interface_data_to_video(&data, "BV1x", Some(&rules), false, true, false);
        assert_eq!(video.title, "a_b");
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("a_b"));
        // Sanitized strings match, so the part name is omitted
        assert_eq!(video.parts[0].default_title, "a_b");
    }

    #[test]
    fn web_interface_data_to_video_omits_part_matching_title_after_trim() {
        // Part name equals the title except for surrounding whitespace
        let pages = vec![page(1, 1, " My Song ", 60)];
        let data = view_data("My Song", "http://pic", 0, Some(pages));
        let video = web_interface_data_to_video(&data, "BV1x", None, false, true, false);
        assert_eq!(video.parts[0].default_title, "My Song");
    }

    #[test]
    fn web_interface_data_to_video_keeps_duplicate_title_when_omission_off() {
        let data = view_data("Main Title", "http://pic", 7, Some(vec![]));
        let video = web_interface_data_to_video(&data, "BV1x", None, false, false, false);
        assert_eq!(video.parts[0].default_title, "Main Title Main Title");
    }

    /// Whitelist for retryable ERR:: codes (issue #484): only
    /// ERR::INVALID_MEDIA_RESPONSE may retry; other business errors stay
    /// non-retryable.
    #[test]
    fn test_is_retryable_err_code() {
        assert!(is_retryable_err_code("ERR::INVALID_MEDIA_RESPONSE"));
        // Wrapped / suffixed variants still match (contains-based, matching
        // how download_url errors may carry appended detail).
        assert!(is_retryable_err_code(
            "prefix ERR::INVALID_MEDIA_RESPONSE detail"
        ));

        assert!(!is_retryable_err_code("ERR::CANCELLED"));
        assert!(!is_retryable_err_code("ERR::DISK_FULL"));
        assert!(!is_retryable_err_code("ERR::FILE_EXISTS"));
        assert!(!is_retryable_err_code("ERR::MERGE_FAILED"));
        assert!(!is_retryable_err_code("ERR::NETWORK::2 segment(s) failed"));
        assert!(!is_retryable_err_code("connection reset by peer"));
        assert!(!is_retryable_err_code(""));
    }

    /// Exhaustion keeps whitelisted ERR:: codes verbatim (so callers and
    /// the UI classify them correctly) and wraps transient messages as
    /// ERR::NETWORK (issue #484).
    #[test]
    fn test_exhausted_retry_error() {
        assert_eq!(
            exhausted_retry_error("ERR::INVALID_MEDIA_RESPONSE".to_string()),
            "ERR::INVALID_MEDIA_RESPONSE"
        );
        assert_eq!(
            exhausted_retry_error("2 segment(s) failed".to_string()),
            "ERR::NETWORK::2 segment(s) failed"
        );
        assert_eq!(
            exhausted_retry_error("final size mismatch: 10 vs 20".to_string()),
            "ERR::NETWORK::final size mismatch: 10 vs 20"
        );
    }
}

/// Returns the first non-empty string in a slice, or `None` if all are empty.
///
/// Used to select the first valid (non-empty) string from multiple candidates.
/// Primarily used for selecting quality display names.
///
/// # Arguments
///
/// * `strings` - String slice to search
///
/// # Returns
///
/// Returns `Some(String)` if a non-empty string is found,
/// or `None` if all strings are empty.
///
/// # Examples
///
/// Why: private fn; doctests compile as a separate crate and cannot import it
/// (enforced by the rust-test CI job)
/// ```ignore
/// let options = vec![&"".to_string(), &"1080P".to_string(), &"720P".to_string()];
/// assert_eq!(first_non_empty(&options), Some("1080P".to_string()));
/// ```
fn first_non_empty(strings: &[&String]) -> Option<String> {
    strings.iter().find(|s| !s.is_empty()).map(|s| (*s).clone())
}

/// Converts a quality ID to a human-readable string representation.
///
/// Maps Bilibili quality IDs to display names like "4K", "1080P60", "1080P", etc.
/// Falls back to "Q{id}" format for unknown quality IDs.
///
/// # Arguments
///
/// * `quality` - Bilibili quality ID per the official playurl qn table
///   (e.g., 120 for 4K, 80 for 1080P; see `references/bilibili-API-collect`)
///
/// # Returns
///
/// Human-readable quality string.
pub(crate) fn quality_to_string(quality: &i32) -> String {
    match quality {
        127 => "8K".to_string(),
        126 => "Dolby Vision".to_string(),
        125 => "HDR10".to_string(),
        120 => "4K".to_string(),
        116 => "1080P60".to_string(),
        112 => "1080P+".to_string(),
        80 => "1080P".to_string(),
        74 => "720P60".to_string(),
        64 => "720P".to_string(),
        32 => "480P".to_string(),
        16 => "360P".to_string(),
        _ => format!("Q{quality}"),
    }
}

/// Fetches video information for history entries.
///
/// Used to retrieve video title and thumbnail when saving download history.
/// Returns `None` on all failures (network errors, API errors, etc.) without error propagation.
///
/// # Arguments
///
/// * `bvid` - Bilibili video ID
/// * `cookies` - Cookie entries for authentication
///
/// # Returns
///
/// Returns `Some((title, thumbnail_url))` on success.
/// Returns `None` on failure.
pub(crate) async fn fetch_video_info_for_history(
    bvid: &str,
    cookies: &[CookieEntry],
) -> Option<(String, Option<String>)> {
    // Why: shared wbi/view path — the unsigned endpoint 412-blocks
    // cookie-less requests, which used to strip the title/thumbnail from
    // history entries for logged-out users.
    let api = BiliApi::from_cookies(cookies).ok()?;
    let body = fetch_wbi_view(&api, bvid).await.ok()?;

    let data = body.data?;
    let thumbnail_url = (!data.pic.is_empty()).then_some(data.pic);
    Some((data.title, thumbnail_url))
}

/// Extracts just the host (CDN origin) from a Bilibili media URL for
/// logging, so signed query parameters (mid, upsig, deadline, ...) are
/// never written to logs that may be shared for diagnostics.
fn url_host(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "<invalid>".to_string())
}

/// Downloads audio with fallback to alternative streams.
///
/// When primary audio URL fails with an invalid media response (e.g., 18-byte error
/// page instead of actual audio), tries alternative audio streams from the quality
/// list. This handles VIP-specific CDN edge cases where some audio formats are
/// unavailable or return error responses.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `download_id` - Unique download ID for progress tracking
/// * `primary_url` - Primary audio URL to try first
/// * `backup_urls` - Backup URLs for the primary stream
/// * `output_path` - Where to save the downloaded audio
/// * `cookie` - Cookie header for authentication
/// * `all_audio_streams` - All available audio streams for fallback
///
/// # Returns
///
/// Returns `Ok(())` on successful download (primary or fallback).
///
/// # Errors
///
/// Returns `ERR::AUDIO_DOWNLOAD_FAILED` if all attempts fail.
#[allow(clippy::too_many_arguments)]
async fn download_audio_with_fallback<R: tauri::Runtime>(
    app: &AppHandle<R>,
    codec_priority: crate::utils::codec::VideoCodecPriority,
    segment_concurrency: usize,
    download_id: &str,
    primary_url: String,
    backup_urls: Option<Vec<String>>,
    output_path: PathBuf,
    cookie: Option<String>,
    all_audio_streams: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    refetch_ctx: &AudioRefetchCtx,
    host_health: Arc<crate::utils::cdn_selector::HostHealth>,
) -> Result<(), String> {
    // Resolve the requested (primary) audio quality id from the stream
    // list so any fallback can be logged as an explicit
    // "quality X -> Y" transition for traceability.
    let primary_quality_id = all_audio_streams
        .iter()
        .find(|s| s.base_url == primary_url)
        .map(|s| s.id);

    log::info!(
        "[BE] download_audio_with_fallback: starting audio download id={}, primary quality_id={:?}, host={}",
        download_id,
        primary_quality_id,
        url_host(&primary_url)
    );

    // Refetch inputs for attempt > 1 (bilibili signed URLs expire after 120 min).
    let a_refetch_api = refetch_ctx.api.clone();
    let a_refetch_bvid = refetch_ctx.bvid.clone();
    let a_cid = refetch_ctx.cid;
    let a_ep_id = refetch_ctx.ep_id;
    let a_quality = refetch_ctx.audio_quality;
    let a_download_id = download_id.to_string();
    // Clone the download args so the primary closure can own them without
    // moving the originals (the fallback loop below still needs them).
    let a_primary_url = primary_url.clone();
    let a_backup_urls = backup_urls.clone();
    let a_output_path = output_path.clone();
    let a_cookie = cookie.clone();
    let a_host_health = host_health.clone();

    // Try primary URL first
    let primary_result = retry_download(app, download_id, Some("audio"), move |attempt: u8| {
        // Re-clone per call: async move consumes captured values, but FnMut may
        // invoke the closure up to MAX_ATTEMPTS times.
        let a_api = a_refetch_api.clone();
        let a_codec_priority = codec_priority;
        let bvid = a_refetch_bvid.clone();
        let primary_url = a_primary_url.clone();
        let backup_urls = a_backup_urls.clone();
        let output_path = a_output_path.clone();
        let cookie = a_cookie.clone();
        let download_id = a_download_id.clone();
        let host_health = a_host_health.clone();
        async move {
            let (url, backups) = if attempt == 1 {
                (primary_url.clone(), backup_urls.clone())
            } else {
                log::info!(
                    "[BE] download_audio: playurl refetch attempt={} for primary audio",
                    attempt
                );
                // video_quality = -1 (best) is unused; only the audio slot matters.
                match refetch_dash_urls(
                    &a_api,
                    a_codec_priority,
                    &bvid,
                    a_cid,
                    a_ep_id,
                    -1,
                    a_quality,
                )
                .await
                {
                    Ok(fresh) => (fresh.audio_url, fresh.audio_backup_urls),
                    Err(e) => {
                        log::warn!("[BE] audio refetch failed, retrying with stale URL: {}", e);
                        (primary_url.clone(), backup_urls.clone())
                    }
                }
            };
            download_url(
                app,
                url,
                backups,
                output_path,
                cookie,
                true,
                Some(download_id),
                None,
                false,
                segment_concurrency,
                host_health,
            )
            .await
        }
    })
    .await;

    match primary_result {
        Ok(()) => {
            log::info!(
                "[BE] download_audio_with_fallback: primary audio succeeded (quality_id={:?}) id={}",
                primary_quality_id,
                download_id
            );
            Ok(())
        }
        Err(e) => {
            // Check if this is an invalid media response (18-byte error page)
            // In this case, try alternative audio streams
            // Why: ERR::NETWORK is grouped with the invalid-media error because
            // both are tied to a specific URL/CDN edge rather than the whole
            // environment, so a different stream URL may still succeed. This is
            // the complement of the systemic errors (cancel/disk-full/file-exists)
            // that are documented as affecting every remaining stream and abort.
            if e.contains("ERR::INVALID_MEDIA_RESPONSE") || e.contains("ERR::NETWORK") {
                log::warn!(
                    "[BE] download_audio_with_fallback: primary audio (quality_id={:?}) failed with {} - trying fallback streams id={}",
                    primary_quality_id,
                    e,
                    download_id
                );

                // Try alternative audio streams (excluding the already-tried primary URL)
                for (idx, stream) in all_audio_streams.iter().enumerate() {
                    // Skip the primary stream if it's in the list
                    if stream.base_url == primary_url {
                        continue;
                    }

                    log::info!(
                        "[BE] download_audio_with_fallback: trying fallback audio stream {}/{} id={}, quality_id={}, host={}",
                        idx + 1,
                        all_audio_streams.len(),
                        download_id,
                        stream.id,
                        url_host(&stream.base_url)
                    );

                    // Clone variables for the fallback closure to avoid move errors
                    let output_path_clone = output_path.clone();
                    let cookie_clone = cookie.clone();
                    let stream_health = host_health.clone();

                    // CONSTRAINT: fallback loop intentionally does NOT refetch playurl on
                    // retry (issue #482 design decision). Each iteration already switches
                    // to a different audio stream (different CDN edge), which is the
                    // recovery mechanism here; refetching the same quality's signature
                    // would add complexity (stream-id remapping) for little gain.
                    let fallback_result =
                        retry_download(app, download_id, Some("audio"), move |_attempt: u8| {
                            download_url(
                                app,
                                stream.base_url.clone(),
                                stream.backup_urls.clone(),
                                output_path_clone.clone(),
                                cookie_clone.clone(),
                                true,
                                Some(download_id.to_string()),
                                None,
                                false,
                                segment_concurrency,
                                stream_health.clone(),
                            )
                        })
                        .await;

                    match fallback_result {
                        Ok(()) => {
                            log::info!(
                                "[BE] download_audio_with_fallback: audio quality fallback {:?} -> {} succeeded id={}",
                                primary_quality_id,
                                stream.id,
                                download_id
                            );
                            return Ok(());
                        }
                        Err(fallback_err) => {
                            // Systemic errors (user cancel, full disk, ...)
                            // affect every remaining stream — abort
                            // immediately and preserve the true cause
                            // instead of looping through the rest and
                            // masking it as ERR::AUDIO_DOWNLOAD_FAILED.
                            if fallback_err.contains("ERR::CANCELLED")
                                || fallback_err.contains("ERR::DISK_FULL")
                                || fallback_err.contains("ERR::FILE_EXISTS")
                            {
                                return Err(fallback_err);
                            }
                            log::warn!(
                                "[BE] download_audio_with_fallback: fallback audio stream {} (quality_id={}) failed with {} id={}",
                                idx + 1,
                                stream.id,
                                fallback_err,
                                download_id
                            );
                            continue;
                        }
                    }
                }

                log::error!(
                    "[BE] download_audio_with_fallback: all audio streams exhausted id={} (primary quality_id={:?})",
                    download_id,
                    primary_quality_id
                );
                Err("ERR::AUDIO_DOWNLOAD_FAILED".to_string())
            } else {
                // For other errors (disk full, cancelled, etc.), don't attempt fallback
                log::error!(
                    "[BE] download_audio_with_fallback: non-retryable error id={}: {}",
                    download_id,
                    e
                );
                Err(e)
            }
        }
    }
}

/// Fetches logged-in user information from Bilibili.
///
/// If no cookies exist, returns user info with `is_login=false`.
/// Used to check authentication status and retrieve logged-in user's name and ID.
///
/// # Arguments
///
/// * `app` - Tauri application handle for cookie cache access
///
/// # Returns
///
/// Returns a `User` struct:
/// - With cookies: User info fetched from API
/// - Without cookies: Default info with `is_login=false`, `has_cookie=false`
///
/// # Errors
///
/// Returns error on HTTP request or JSON parse failure.
pub async fn fetch_user_info(app: &AppHandle) -> Result<User, String> {
    log::info!("[BE] fetch_user_info: checking login status");

    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let has_cookie = !cookie_header.is_empty();

    if !has_cookie {
        return Ok(User {
            code: 0,
            message: String::new(),
            data: UserData {
                mid: None,
                uname: None,
                is_login: false,
            },
            has_cookie: false,
        });
    }

    let api = BiliApi::from_cookie_header(cookie_header)?;
    fetch_user_info_with(&api).await
}

/// Transport-injectable core of [`fetch_user_info`] (test seam).
async fn fetch_user_info_with(api: &BiliApi) -> Result<User, String> {
    let body = api
        .get("/x/web-interface/nav")
        .await?
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;

    log::info!(
        "[BE] fetch_user_info: is_login={}, uname={}",
        body.data.is_login,
        body.data.uname.as_deref().unwrap_or("N/A")
    );

    Ok(User {
        code: body.code,
        message: body.message,
        data: UserData {
            mid: body.data.mid,
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
        has_cookie: true,
    })
}

/// Builds a Cookie header string from cookie entries.
///
/// Filters only bilibili.com domain cookies and
/// formats them in "name=value; name=value" format.
///
/// # Arguments
///
/// * `cookies` - Slice of cookie entries to filter and format
///
/// # Returns
///
/// Returns the Cookie header string (empty string if no matching cookies).
fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    cookies
        .iter()
        .filter(|c| c.host.ends_with("bilibili.com"))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Builds a Cookie header string from cached cookies.
///
/// Reads cookies from the application's cookie cache and builds a header string.
/// This function assumes cookies exist and returns an error if the cache is empty.
///
/// # Arguments
///
/// * `app` - Tauri application handle for cookie cache access
///
/// # Returns
///
/// Returns the Cookie header string on success.
///
/// # Errors
///
/// Returns `ERR::COOKIE_MISSING` if no cookies are available in the cache.
pub fn build_cookie_header_from_cache(app: &AppHandle) -> Result<String, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    if header.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }
    Ok(header)
}

/// Fetches video metadata from Bilibili.
///
/// Retrieves video title, parts (pages), and basic information.
/// Quality options and subtitles are fetched lazily via separate API calls.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `id` - Bilibili video ID (BV identifier, e.g., "BV1xx411c7XD")
///
/// # Returns
///
/// Returns a `Video` struct with title, bvid, parts, and quality limitation flag.
///
/// # Errors
///
/// Returns an error if:
/// - Video is not found (`ERR::VIDEO_NOT_FOUND`)
/// - API request fails (`ERR::API_ERROR`)
pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    log::info!("[BE] fetch_video_info: requesting video info for id={}", id);

    // E2E mode: CI runner IPs are blocked by Bilibili's risk control
    // (issue #565), so serve the bundled fixture instead of the live
    // view API. Same env-var pattern as qr_login's secure-storage bypass.
    if crate::handlers::qr_login::is_e2e_testing() {
        log::info!("[BE] fetch_video_info: returning E2E_TESTING fixture");
        return e2e_mock_video_info(id);
    }

    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let res_body = fetch_video_title_by_bvid(id, &cookies).await?;
    let data = res_body.data.as_ref().unwrap();

    // av-URL lookup: map to the canonical BV the API returns so every
    // downstream consumer (playurl, download options, history) sees a BV.
    let canonical_id = canonical_video_id(id, &data.bvid);

    log::info!(
        "[BE] fetch_video_info: received video title=\"{}\", parts={}",
        data.title,
        data.pages.as_ref().map(|p| p.len()).unwrap_or(0)
    );

    // Check if this video redirects to a bangumi episode
    if let Some(redirect_url) = &data.redirect_url {
        if let Some(ep_id) = extract_bangumi_ep_id(redirect_url) {
            return fetch_bangumi_info(app, ep_id).await;
        }
    }

    let settings = settings::get_settings(app).await.ok();
    let replacements = settings
        .as_ref()
        .and_then(|s| s.title_replacements.as_deref());
    let auto_rename = settings
        .as_ref()
        .and_then(|s| s.auto_rename_duplicates)
        .unwrap_or(true);
    let omit_duplicate = settings
        .as_ref()
        .and_then(|s| s.omit_duplicate_part_title)
        .unwrap_or(true);

    Ok(web_interface_data_to_video(
        data,
        canonical_id,
        replacements,
        auto_rename,
        omit_duplicate,
        is_limited_quality,
    ))
}

/// Builds the E2E fixture `Video` from the bundled view-API fixture JSON.
///
/// Parses `tests/fixtures/web_interface_view.json` (a 2-page view
/// response) and runs it through the production `Video` mapping so the
/// E2E flow exercises the same shaping logic as the live path.
fn e2e_mock_video_info(id: &str) -> Result<Video, String> {
    e2e_mock_video_info_with_pic_base(id, std::env::var("E2E_API_BASE").ok().as_deref())
}

/// Pic-override core of [`e2e_mock_video_info`]; takes the fixture-server
/// origin explicitly so the swap matrix is unit-testable without mutating
/// process-global env from parallel tests.
fn e2e_mock_video_info_with_pic_base(id: &str, pic_base: Option<&str>) -> Result<Video, String> {
    // Note: The fixture JSON is pinned by assertions elsewhere — the cid/page
    // pairs in test_e2e_mock_video_info and the 3-part assertion in
    // e2e-tests/test/app-launch.e2e.ts both fail if the fixture is swapped
    // for a different video, so update all three together.
    const FIXTURE: &str = include_str!("../../tests/fixtures/web_interface_view.json");
    let mut body: WebInterfaceApiResponse =
        serde_json::from_str(FIXTURE).map_err(|e| format!("E2E fixture parse failed: {e}"))?;
    let data = body.data.as_mut().ok_or("E2E fixture has no data")?;
    // E2E determinism: the snapshot's hdslb.com URLs are live today but
    // reachable only from Bilibili-friendly networks (CI runners are
    // risk-control blocked), and CDN entries get pruned over time (the
    // previous snapshot's URLs went 404). When a fixture server is
    // configured, swap pic — and every page's first_frame, which the part
    // mapper prefers over pic — for the committed fixture thumbnail.
    if let Some(base) = pic_base {
        let thumb = format!("{base}/media/thumb.png");
        data.pic = thumb.clone();
        if let Some(pages) = data.pages.as_mut() {
            for page in pages {
                page.first_frame = Some(thumb.clone());
            }
        }
    }
    // Why: is_limited_quality=true mirrors the live path's cookie-less case —
    // E2E_TESTING bypasses session storage (qr_login::is_e2e_testing), so CI
    // never has a cookie header (live path: is_limited_quality = cookie_header
    // .is_empty()).
    // Note: The fixture is a snapshot of BV1GJ411x7h7 (added for the serde
    // contract tests, commit 6a23fbc8), not of the BV typed in the E2E spec
    // (BV1i3411y7xB). The mapping overrides bvid with the requested id, so the
    // UI shows the snapshot video's title/parts for whatever URL was entered.
    Ok(web_interface_data_to_video(
        data, id, None, true, true, true,
    ))
}

/// Fills each part's `default_title` from the sanitized video title.
///
/// Must run after duplicate-title resolution so a suffixed part name
/// (e.g., "Title (1)") no longer matches the title.
fn fill_default_part_titles(parts: &mut [VideoPart], sanitized_title: &str, omit_duplicate: bool) {
    use crate::utils::sanitize::build_default_part_title;

    for part in parts.iter_mut() {
        let sanitized_part = part.sanitized_part.as_deref().unwrap_or(&part.part);
        part.default_title =
            build_default_part_title(sanitized_title, sanitized_part, omit_duplicate);
    }
}

/// Maps a WebInterface view response into the frontend `Video` DTO.
///
/// Extracted from `fetch_video_info` so the mapping (title sanitization,
/// single-part vs multi-part shaping, duplicate-title resolution) is
/// testable without network access.
fn web_interface_data_to_video(
    data: &WebInterfaceApiResponseData,
    id: &str,
    replacements: Option<&[crate::models::settings::TitleReplacement]>,
    auto_rename: bool,
    omit_duplicate: bool,
    is_limited_quality: bool,
) -> Video {
    use crate::utils::sanitize::{apply_title_replacements, resolve_duplicate_titles};

    let sanitized_title = apply_title_replacements(&data.title, replacements);
    let pages = data.pages.as_deref().unwrap_or(&[]);

    let mut parts = if pages.is_empty() {
        vec![VideoPart {
            cid: data.cid,
            page: 1,
            part: data.title.clone(),
            sanitized_part: Some(sanitized_title.clone()),
            default_title: String::new(),
            duration: 0,
            thumbnail: Thumbnail {
                url: data.pic.clone(),
            },
            video_qualities: vec![],
            audio_qualities: vec![],
            subtitles: vec![],
            ep_id: None,
            status: None,
            aid: None,
            is_preview: None,
        }]
    } else {
        pages
            .iter()
            .map(|page| {
                let thumb_url = page
                    .first_frame
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&data.pic);
                let part_name = if page.part.is_empty() {
                    &data.title
                } else {
                    &page.part
                };
                let sanitized_part = apply_title_replacements(part_name, replacements);
                VideoPart {
                    cid: page.cid,
                    page: page.page,
                    part: part_name.to_string(),
                    sanitized_part: Some(sanitized_part),
                    default_title: String::new(),
                    duration: page.duration,
                    thumbnail: Thumbnail {
                        url: thumb_url.to_string(),
                    },
                    video_qualities: vec![],
                    audio_qualities: vec![],
                    subtitles: vec![],
                    ep_id: None,
                    status: None,
                    aid: None,
                    is_preview: None,
                }
            })
            .collect()
    };

    if auto_rename {
        let sanitized_titles: Vec<String> = parts
            .iter()
            .filter_map(|p| p.sanitized_part.as_ref())
            .cloned()
            .collect();
        let resolved_titles = resolve_duplicate_titles(&sanitized_titles);
        let mut resolved_iter = resolved_titles.into_iter();
        for part in parts.iter_mut() {
            if part.sanitized_part.is_some() {
                part.sanitized_part = resolved_iter.next();
            }
        }
    }

    fill_default_part_titles(&mut parts, &sanitized_title, omit_duplicate);

    Video {
        title: sanitized_title,
        bvid: id.to_string(),
        parts,
        is_limited_quality,
        content_type: "video".to_string(),
        ep_id: None,
        season_title: None,
    }
}

/// Quality rank of a video stream id.
///
/// The video `qn` table is a designed quality ladder (16 360p < … < 127 8K),
/// so the numeric id itself is the rank.
fn video_quality_rank(id: i32) -> i32 {
    id
}

// Note: the mirrored table lives in-repo at
// references/bilibili-API-collect/docs/video/videostream_url.md
// (§ 视频伴音音质代码).
/// Quality rank of an audio stream id.
///
/// Audio ids are allocated by history, not quality: the VIP tiers 30250
/// (Dolby Atmos) / 30251 (Hi-Res Lossless) sit numerically BELOW the older
/// 30280 (192K). The ladder mirrors the bilibili-API-collect
/// 视频伴音音质代码 table, which lists the codes in ascending quality
/// (64K < 132K < 192K < Dolby < Hi-Res). Undocumented ids rank below every
/// known tier: they stay selectable in the UI but the best-effort default
/// never auto-picks an unknown tier.
fn audio_quality_rank(id: i32) -> i32 {
    match id {
        30251 => 5, // Hi-Res Lossless
        30250 => 4, // Dolby Atmos
        30280 => 3, // 192K AAC
        30232 => 2, // 132K
        30216 => 1, // 64K
        _ => 0,
    }
}

/// Best-effort audio quality id for downloads without an explicit pick:
/// highest by quality rank (NOT numeric id — see `audio_quality_rank`),
/// with the numeric id as a deterministic tie-break.
fn best_audio_quality_id(streams: &[XPlayerApiResponseVideo]) -> Option<i32> {
    streams
        .iter()
        .max_by_key(|a| (audio_quality_rank(a.id), a.id))
        .map(|a| a.id)
}

/// Converts API video/audio quality data to frontend DTO format.
///
/// Processes raw quality data from Bilibili API and converts it to a format
/// usable by the frontend, sorted by quality (highest first). When multiple
/// entries share a quality ID, the highest codec ID wins the slot.
///
/// `rank` supplies the ordering policy per stream family: video ids are a
/// spec-guaranteed ladder, audio ids are not (see `audio_quality_rank`).
/// Same-rank ids tie-break on the numeric id, descending.
fn convert_qualities(streams: &[XPlayerApiResponseVideo], rank: fn(i32) -> i32) -> Vec<Quality> {
    let mut qualities: BTreeMap<i32, &XPlayerApiResponseVideo> = BTreeMap::new();

    for item in streams {
        qualities
            .entry(item.id)
            .and_modify(|existing| {
                if item.codecid > existing.codecid {
                    *existing = item;
                }
            })
            .or_insert(item);
    }

    let mut out: Vec<Quality> = qualities
        .into_iter()
        .map(|(id, v)| Quality {
            id,
            codecid: v.codecid,
            quality: quality_to_string(&id),
        })
        .collect();
    // Reverse((rank, id)) = descending by rank, numeric id as tie-break.
    out.sort_by_key(|q| std::cmp::Reverse((rank(q.id), q.id)));
    out
}

/// Fetches video title and page information from Bilibili Web Interface API.
///
/// Retrieves basic video metadata including title, thumbnail, and page list.
/// Used as the initial API call when fetching video information.
///
/// # Arguments
///
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cookies` - Cookie entries for authentication (recommended but optional)
///
/// # Returns
///
/// Returns raw API response containing video data.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Network request failure
/// - Non-success HTTP status
/// - API returns non-zero code
/// - Video not found (`ERR::VIDEO_NOT_FOUND`)
async fn fetch_video_title_by_bvid(
    bvid: &str,
    cookies: &[CookieEntry],
) -> Result<WebInterfaceApiResponse, String> {
    let api = BiliApi::from_cookies(cookies)?;
    fetch_wbi_view(&api, bvid).await
}

/// Resolves a video identifier for WBI API query params.
///
/// `/video/av{id}` URLs carry the legacy numeric aid, which the endpoints
/// accept via the `aid` param; anything else (BV…) goes through `bvid`.
/// Passing an "av…" string as `bvid` is rejected by the API with
/// ERR::API_ERROR (found while testing an av-URL by hand).
fn wbi_video_param(id: &str) -> (&'static str, String) {
    match id.strip_prefix("av") {
        Some(aid) if !aid.is_empty() && aid.bytes().all(|b| b.is_ascii_digit()) => {
            ("aid", aid.to_string())
        }
        _ => ("bvid", id.to_string()),
    }
}

/// Canonical id for downstream use (playurl, download options, history):
/// an av-URL lookup resolves to the BV the API returns; a BV request keeps
/// the requested id.
fn canonical_video_id<'a>(requested: &'a str, api_bvid: &'a str) -> &'a str {
    if requested.starts_with("av") {
        api_bvid
    } else {
        requested
    }
}

/// Removes `<em class="keyword">` highlight tags the search API embeds in
/// result titles (bare `<em>` variant also stripped defensively).
fn strip_keyword_em_tags(title: &str) -> String {
    title
        .replace("<em class=\"keyword\">", "")
        .replace("<em>", "")
        .replace("</em>", "")
}

/// Unescapes the HTML entities bilibili embeds in search titles
/// ("Mr. &amp; Mrs.", "Mrs. Kelly&#x27;s Class" — observed on the live API).
/// Handles the common named entities plus decimal/hex numeric references;
/// anything else is left untouched.
fn unescape_title_entities(title: &str) -> String {
    let Some(first) = title.find('&') else {
        return title.to_string();
    };
    let mut out = String::with_capacity(title.len());
    out.push_str(&title[..first]);
    let rest = &title[first..];
    let mut chars = rest.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c != '&' {
            out.push(c);
            continue;
        }
        // Find the entity end within a sane window; otherwise emit '&' as-is.
        let tail = &rest[i + 1..];
        let Some(semi) = tail.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            continue;
        };
        let ent = &tail[..semi];
        let decoded = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" | "#x27" | "#X27" => Some('\''),
            "nbsp" => Some(' '),
            _ => {
                // Numeric references: &#123; / &#x1F600;
                if let Some(num) = ent.strip_prefix('#') {
                    let radix = if let Some(hex) = num.strip_prefix(['x', 'X']) {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        num.parse::<u32>().ok()
                    };
                    radix.and_then(char::from_u32)
                } else {
                    None
                }
            }
        };
        match decoded {
            Some(ch) => {
                out.push(ch);
                // Skip past the consumed entity.
                for _ in 0..=semi {
                    chars.next();
                }
            }
            None => out.push('&'),
        }
    }
    out
}

/// Normalizes protocol-relative cover URLs ("//host/…") to https so the
/// webview does not resolve them against the app origin.
fn normalize_cover_url(pic: &str) -> String {
    if let Some(rest) = pic.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        pic.to_string()
    }
}

/// Normalizes a wire-format duration into seconds.
///
/// Why: the real search API returns durations as "m:ss"-style strings
/// ("4:47", "186:34", sometimes ""), while the reference doc example shows
/// plain integers — a strict i64 field failed the whole response parse
/// (found during first manual verification). Both shapes are accepted; the
/// fold also handles "h:mm:ss" and bare-second strings. Unparseable → 0.
fn duration_seconds(value: Option<&serde_json::Value>) -> i64 {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s
            .split(':')
            .try_fold(0i64, |acc, part| {
                // ponytail: saturating (not checked) — a hostile/huge wire
                // value must not panic the command; clamping is enough.
                part.trim()
                    .parse::<i64>()
                    .map(|n| acc.saturating_mul(60).saturating_add(n))
            })
            .unwrap_or(0),
        _ => 0,
    }
}

/// WBI-signed view-API fetch shared by metadata and history saving.
///
/// Why: the unsigned `/x/web-interface/view` endpoint is rejected by
/// Bilibili's risk control with HTTP 412 for cookie-less (logged-out)
/// requests, so guest metadata fetches always failed with ERR::API_ERROR.
/// The WBI-signed variant accepts anonymous requests (guests then get the
/// 480p-capped playurl manifest), matching what the web player sends.
///
/// Takes a pre-built [`BiliApi`] (instead of cookie entries) so wiremock
/// tests can point `base` at a local server.
async fn fetch_wbi_view(api: &BiliApi, bvid: &str) -> Result<WebInterfaceApiResponse, String> {
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;

    let (id_key, id_val) = wbi_video_param(bvid);
    let mut params = BTreeMap::from([(id_key.to_string(), id_val)]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs) and this query is built from `params`, so
    // pushing wts again would send the pair twice; wbi endpoints return
    // v_voucher when wts/w_rid are missing or wrong
    // (references/bilibili-API-collect/docs/misc/sign/wbi.md)
    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));

    let body: WebInterfaceApiResponse = api
        .get_q("/x/web-interface/wbi/view", &query)
        .await?
        .json()
        .await
        .map_err(|e| format!("WebInterface Api Failed to parse response JSON: {e}"))?;

    if let Err(e) = validate_api_response(body.code, body.data.as_ref()) {
        // Why log here: validate_api_response standardizes the code to
        // ERR::* and drops Bilibili's own message, which is the only
        // signal distinguishing deleted videos from region/charge-blocked
        // ones (-404 covers all three) when diagnosing from app.log.
        log::warn!(
            "[BE] fetch_wbi_view: view API rejected bvid={bvid}, code={}, message=\"{}\"",
            body.code,
            body.message
        );
        return Err(e);
    }
    Ok(body)
}

/// Fetches video stream URLs and quality options from the Bilibili Player API.
///
/// Uses WBI signature for authentication. Retrieves DASH stream URLs
/// for both video and audio at the highest available quality.
///
/// # Arguments
///
/// * `cookies` - Cookie entries for authentication
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns the XPlayer API response containing DASH stream data.
///
/// # Errors
///
/// Returns an error if:
/// - WBI mixin key cannot be fetched
/// - WBI signature generation fails
/// - Network request fails
/// - API returns non-zero code
async fn fetch_video_details(
    api: &BiliApi,
    bvid: &str,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    fetch_video_details_with_fnval(api, bvid, cid, PLAYURL_FNVAL).await
}

/// Playurl fetch with an explicit `fnval` (format negotiation) value.
///
/// `PLAYURL_FNVAL` requests the DASH manifest; `0` requests the legacy
/// `durl` muxed stream (audio embedded in the container).
async fn fetch_video_details_with_fnval(
    api: &BiliApi,
    bvid: &str,
    cid: i64,
    fnval: i32,
) -> Result<XPlayerApiResponse, String> {
    log::info!(
        "[BE] fetch_video_details: requesting bvid={}, cid={}, fnval={}",
        bvid,
        cid,
        fnval
    );
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;

    let (id_key, id_val) = wbi_video_param(bvid);
    let mut params = BTreeMap::from([
        (id_key.to_string(), id_val),
        ("cid".to_string(), cid.to_string()),
        ("qn".to_string(), PLAYURL_QN.to_string()),
        ("fnval".to_string(), fnval.to_string()),
        ("fnver".to_string(), "0".to_string()),
        ("fourk".to_string(), "1".to_string()),
    ]);

    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs) and this query is built from `params`, so
    // pushing wts again would send the pair twice; wbi endpoints return
    // v_voucher when wts/w_rid are missing or wrong
    // (references/bilibili-API-collect/docs/misc/sign/wbi.md)
    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));

    let body: XPlayerApiResponse = api
        .get_q("/x/player/wbi/playurl", &query)
        .await?
        .json()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
    Ok(body)
}

/// Multi-process safe output-file reservation (issue #560, issue #595).
///
/// Two app instances downloading to the same output filename used to race:
/// the old `auto_rename` checked `path.exists()` once at download start
/// (TOCTOU), so both processes could grab `video.mp4` and their ffmpeg merges
/// would overwrite each other. This reservation closes that window with two
/// OS-level primitives:
///
/// - `File::create_new` (O_EXCL) on the sidecar lock file — exactly one
///   process can create it; creation is atomic, so there is no
///   check-then-create gap to slip through.
/// - an exclusive `flock` held on the sidecar for the download's lifetime —
///   if the owning process dies, the OS releases the lock, so the leftover
///   reservation is detectably dead and the next download reclaims it.
///
/// The lock lives on a sidecar file named after the FINAL path
/// (`video.mp4` -> `video.mp4.lock`), never on the payload (issue #595):
/// on Windows fs2 maps `lock_exclusive` to `LockFileEx`, a mandatory
/// whole-file byte-range lock, so a flock held on the staging
/// `video.part.mp4` blocked the ffmpeg child process from writing the merge
/// output (os error 33 -> "Permission denied" -> `ERR::MERGE_FAILED`).
/// On Unix it also keeps the liveness signal intact when `download_url`
/// unlinks and re-creates the payload mid-flight (flock follows the inode).
///
/// All output (direct durl downloads, ffmpeg merges) is written to the
/// reserved staging name (`{stem}.part.{ext}`) and only renamed to the
/// final user-visible name on success, so a crashed download can never leave
/// a half-written `video.mp4` behind — only a `.part` staging file plus the
/// sidecar, which startup cleanup removes.
struct OutputReservation {
    /// Final user-visible path (e.g. `video.mp4`).
    final_path: PathBuf,
    /// Staging path all bytes are written to (e.g. `video.part.mp4`).
    reserved_path: PathBuf,
    /// Holds the exclusive flock on the sidecar lock file for the download's
    /// lifetime. Releasing it (drop / process death) is what marks this
    /// reservation as reclaimable.
    lock_file: Option<File>,
    completed: bool,
}

impl OutputReservation {
    fn new(final_path: PathBuf, lock_file: File) -> Self {
        Self {
            reserved_path: part_path(&final_path),
            final_path,
            lock_file: Some(lock_file),
            completed: false,
        }
    }

    /// The path download bytes must be written to.
    fn reserved_path(&self) -> &Path {
        &self.reserved_path
    }

    /// Renames the completed staging file to its final name and releases the
    /// reservation. Consumes `self`; returns the final path.
    ///
    /// Secondary defense: if the final name appeared while we were
    /// downloading (another instance completed the same name after our
    /// reservation), falls through to the next unused variant instead of
    /// clobbering the finished file.
    fn complete(mut self) -> Result<PathBuf, String> {
        let target = if self.final_path.exists() {
            candidate_output_paths(&self.final_path)
                .into_iter()
                .find(|c| !c.exists())
                .unwrap_or_else(|| self.final_path.clone())
        } else {
            self.final_path.clone()
        };
        fs::rename(&self.reserved_path, &target)
            .map_err(|e| format!("Failed to finalize output file: {}", e))?;
        self.completed = true;
        // Release the flock BEFORE removing the sidecar (required on
        // Windows; same rule as HistorySession's Drop). The sidecar is named
        // after the claimed candidate, so shifting the rename target to a
        // " (N)" variant never changes which lock file to remove.
        self.lock_file = None;
        let _ = fs::remove_file(lock_sidecar_path(&self.final_path));
        Ok(target)
    }
}

impl Drop for OutputReservation {
    fn drop(&mut self) {
        // Anything but a successful complete() — including early `?` returns,
        // cancellation, and merge failures — removes the staging file so no
        // zero-byte or partial garbage accumulates. (A hard process kill
        // skips Drop; startup cleanup and dead-reservation reclamation cover
        // that case.)
        if !self.completed {
            let _ = fs::remove_file(&self.reserved_path);
        }
        self.lock_file = None; // release the flock before removing (Windows)
        let _ = fs::remove_file(lock_sidecar_path(&self.final_path));
    }
}

/// Holds an exclusive flock on each temp file's SIDE CAR lock file
/// (`temp_video_X.m4s` -> `temp_video_X.m4s.lock`) for the caller's
/// lifetime. The payload temp itself is never locked (issue #595): on
/// Windows `LockFileEx` is a mandatory lock that would block our own
/// writers, and on every platform `download_url(is_override=true)` unlinks
/// and re-creates the payload, which would orphan a payload-bound flock.
/// Best-effort: an unpersistable path logs and is skipped rather than
/// failing the download (cleanup then falls back to probing the payload's
/// own flock, same as a pre-#595 leftover).
fn lock_temp_paths(paths: &[&Path]) -> Vec<File> {
    let mut locked = Vec::with_capacity(paths.len());
    for path in paths {
        let lock_path = lock_sidecar_path(path);
        let file = match OpenOptions::new()
            .create(true)
            // truncate(false): a leftover sidecar from a dead run is reused
            // as-is; it holds no payload bytes, so zeroing never matters.
            .truncate(false)
            .write(true)
            .read(true)
            .open(&lock_path)
        {
            Ok(file) => file,
            Err(e) => {
                log::warn!(
                    "[BE] lock_temp_paths: open failed for {}: {}",
                    lock_path.display(),
                    e
                );
                continue;
            }
        };
        if let Err(e) = file.lock_exclusive() {
            log::warn!(
                "[BE] lock_temp_paths: lock failed for {}: {}",
                lock_path.display(),
                e
            );
            continue;
        }
        locked.push(file);
    }
    locked
}

/// Builds the staging path for a candidate final path
/// (`video.mp4` -> `video.part.mp4`).
///
/// Why keep the real extension: ffmpeg infers the output container format
/// from the output path extension.
fn part_path(candidate: &Path) -> PathBuf {
    let stem = candidate
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = candidate
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    candidate.with_file_name(format!("{}.part.{}", stem, ext))
}

/// Appends `.lock` to the file name (`video.mp4` -> `video.mp4.lock`,
/// `temp_video_X.m4s` -> `temp_video_X.m4s.lock`).
///
/// The download-sidecar is named after the FINAL path (not the staging
/// `video.part.mp4`), so it survives the staging->final rename semantics
/// unchanged and mirrors the `{path}.lock` convention of `locked_json.rs`
/// (issue #595).
pub(crate) fn lock_sidecar_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    path.with_file_name(name)
}

/// Yields candidate final paths: the desired name first, then `" (N)"`
/// variants for N in 1..=10_000 (mirrors the historical auto_rename scheme).
fn candidate_output_paths(path: &Path) -> Vec<PathBuf> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");

    let mut candidates = vec![path.to_path_buf()];
    candidates
        .extend((1..=10_000u32).map(|idx| parent.join(format!("{} ({}).{}", stem, idx, ext))));
    candidates
}

/// Tries to claim `candidate` by atomically creating its sidecar lock file
/// (`video.mp4` -> `video.mp4.lock`) and holding an exclusive flock on it
/// (issue #595). The staging payload itself is NOT created here — every
/// writer (ffmpeg `-y`, `download_url`'s preallocate/single-stream paths)
/// creates it on first write, and locking the payload is exactly what broke
/// the Windows merge.
///
/// Reuses [`crate::handlers::history_session::acquire_session_lock`], which
/// also performs dead-holder reclamation: an existing sidecar whose flock
/// can be taken has no live owner (its process died), so it is removed and
/// re-created, and a crashed download never blocks its filename. Returns
/// `None` when the name is taken by a live reservation or cannot be claimed.
fn try_claim(candidate: &Path) -> Option<File> {
    crate::handlers::history_session::acquire_session_lock(&lock_sidecar_path(candidate)).ok()
}

/// Reserves a unique output path for a download (issue #560).
///
/// Walks `desired`, `desired (1)`, ... until a sidecar lock file can be
/// claimed atomically. Falls back to a timestamp-based name if all 10,000
/// variants are taken (mirrors the historical auto_rename behavior).
fn reserve_output_path(desired: &Path) -> Result<OutputReservation, String> {
    for candidate in candidate_output_paths(desired) {
        // Preserve the historical auto_rename contract: never target a name
        // whose final file already exists (a finished download).
        if candidate.exists() {
            continue;
        }
        if let Some(lock_file) = try_claim(&candidate) {
            return Ok(OutputReservation::new(candidate, lock_file));
        }
    }

    // Fallback: timestamp-based name (same scheme as historical auto_rename)
    let parent = desired.parent().unwrap_or(Path::new("."));
    let stem = desired
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = desired
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fallback = parent.join(format!("{}_{}.{}", stem, timestamp, ext));
    let Some(lock_file) = try_claim(&fallback) else {
        return Err("ERR::OUTPUT_RESERVE_FAILED".to_string());
    };
    Ok(OutputReservation::new(fallback, lock_file))
}

/// Builds the full output path for a download file.
///
/// Combines the user-configured download directory with the filename.
/// Automatically appends `.mp4` extension if not already present.
/// Sanitizes the filename by applying title replacement rules from settings.
///
/// # Arguments
///
/// * `app` - Tauri application handle for settings access
/// * `filename` - Desired output filename (with or without extension)
///
/// # Returns
///
/// Returns the complete output path.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Cannot retrieve settings
/// - Download output path is not configured
async fn build_output_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let dl_output_path = settings::get_settings(app)
        .await
        .map_err(|e| format!("Failed to get settings: {e}"))?
        .dl_output_path;
    build_output_path_in(dl_output_path.as_deref(), filename)
}

/// Pure split of [`build_output_path`] over an explicit output dir so tests
/// never touch the (real-home) settings store. `None` mirrors the
/// unconfigured case.
fn build_output_path_in(dl_output_path: Option<&str>, filename: &str) -> Result<PathBuf, String> {
    let output_path =
        dl_output_path.ok_or_else(|| "Download output path is not configured".to_string())?;

    let filename_with_ext = if filename.to_lowercase().ends_with(".mp4") {
        filename.to_string()
    } else {
        format!("{filename}.mp4")
    };

    Ok(PathBuf::from(output_path).join(filename_with_ext))
}

/// Gets the Content-Length of a resource via HEAD request.
///
/// Used to estimate file size for disk space validation before download.
/// Returns `None` on any failure (network error, missing header, etc.).
///
/// # Arguments
///
/// * `url` - URL to check
/// * `cookie` - Optional cookie header for authentication
///
/// # Returns
///
/// Returns `Some(content_length)` on success.
/// Returns `None` on failure.
async fn head_content_length(url: &str, cookie: Option<&str>) -> Option<u64> {
    head_content_length_with(&build_client().ok()?, url, cookie).await
}

/// Client-injected split of [`head_content_length`] (test seam: wiremock).
async fn head_content_length_with(client: &Client, url: &str, cookie: Option<&str>) -> Option<u64> {
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let response = req.send().await.ok()?;

    // Only accept successful responses (200 OK)
    if !response.status().is_success() {
        return None;
    }

    response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

/// Ensures sufficient disk space is available for download.
///
/// Uses `fs2::available_space` (statvfs on Unix, GetDiskFreeSpaceExW on
/// Windows) to check free space at the target location's parent directory.
///
/// # Arguments
///
/// * `target_path` - Path where file will be saved (checks parent directory)
/// * `needed_bytes` - Required disk space in bytes
///
/// # Returns
///
/// Returns `Ok(())` if sufficient space is available, or if free space cannot
/// be queried (fail-open, same as the previous statvfs behavior).
///
/// # Errors
///
/// Returns `ERR::DISK_FULL` if available space is less than needed.
fn ensure_free_space(target_path: &Path, needed_bytes: u64) -> Result<(), String> {
    let dir = target_path.parent().unwrap_or(Path::new("."));
    let Ok(free_bytes) = fs2::available_space(dir) else {
        return Ok(());
    };
    if free_bytes < needed_bytes {
        return Err("ERR::DISK_FULL".into());
    }
    Ok(())
}

/// Retries download operations up to 3 times with linear backoff.
///
/// Implements retry logic for transient network failures originating from
/// `download_url`. Errors are classified by prefix:
///
/// - `ERR::` prefix: Business logic errors (e.g. `ERR::DISK_FULL`,
///   `ERR::CANCELLED`, `ERR::FILE_EXISTS`) are passed through immediately
///   without retry. Exception: whitelisted codes
///   (`ERR::INVALID_MEDIA_RESPONSE`, issue #484) are CDN-edge-scoped error
///   bodies tied to a specific signed URL, so they are retried — the next
///   attempt re-fetches a fresh signed playurl URL (see the closures at
///   each call site).
/// - All other errors: Treated as transient network failures and retried.
///   `download_url` only produces non-`ERR::` errors for network-related
///   causes (request failures, connection resets, timeouts, segment issues),
///   so retrying them unconditionally is safer than keyword matching which
///   previously missed common cases like `connection reset by peer`, DNS
///   failures, and TLS errors.
///
/// # Retry Settings
///
/// - Maximum attempts: 3
/// - Backoff strategy: Linear (500ms, 1000ms, 1500ms)
/// - Final failure is wrapped as `ERR::NETWORK::{original_message}`;
///   whitelisted `ERR::` codes keep their own code so callers and the UI
///   can classify them (issue #484)
///
/// # Retry State Notification
///
/// Emits `download-retrying` events to notify the frontend of retry state
/// changes. Before each retry attempt (attempt > 1), an event with
/// `is_retrying: true` is sent so the frontend can hide the transfer rate
/// display. On success or final failure, `is_retrying: false` is sent to
/// resume normal display.
///
/// # Arguments
///
/// * `app` - Tauri application handle for event emission
/// * `download_id` - Unique identifier for this download
/// * `stage` - Current download stage ("audio" or "video"); when `None`,
///   the frontend applies retry state to all stages for this download
/// * `f` - Async closure that performs the download operation
///
/// # Returns
///
/// Returns `Ok(())` on successful download.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - All retry attempts failed (wrapped as `ERR::NETWORK::*`; whitelisted
///   `ERR::` codes keep their own code)
/// - Error contains a non-whitelisted `ERR::` prefix (passed through
///   unchanged)
///
/// See also: `is_retryable_err_code` / `exhausted_retry_error` for the
/// whitelist and exhaustion-wrapping decisions (issue #484).
async fn retry_download<R: tauri::Runtime, F, Fut>(
    app: &AppHandle<R>,
    download_id: &str,
    stage: Option<&str>,
    mut f: F,
) -> Result<(), String>
where
    F: FnMut(u8) -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    const MAX_ATTEMPTS: u8 = 3;
    const BACKOFF_BASE_MS: u64 = 500;

    let emit_retrying = |is_retrying: bool| {
        let _ = app.emit(
            "download-retrying",
            DownloadRetrying {
                download_id: download_id.to_string(),
                stage: stage.map(|s| s.to_string()),
                is_retrying,
            },
        );
    };

    for attempt in 1..=MAX_ATTEMPTS {
        if attempt > 1 {
            // Notify frontend to hide transfer rate display during retry.
            emit_retrying(true);
        }
        match f(attempt).await {
            Ok(_) => {
                if attempt > 1 {
                    emit_retrying(false);
                }
                return Ok(());
            }
            Err(e) => {
                let msg = e.to_string();

                // ERR:: prefix = business logic error, never retry.
                // Exception: whitelisted codes (issue #484) are CDN-edge
                // error bodies — fall through so the next attempt re-fetches
                // a fresh signed playurl URL before re-downloading.
                if msg.contains("ERR::") && !is_retryable_err_code(&msg) {
                    log::warn!("[BE] retry_download: non-retryable: {msg}");
                    if attempt > 1 {
                        emit_retrying(false);
                    }
                    return Err(msg);
                }

                // Transient network errors and whitelisted ERR:: codes retry;
                // the final attempt wraps as ERR::NETWORK, except whitelisted
                // codes which keep their own semantic code.
                if attempt >= MAX_ATTEMPTS {
                    log::error!("[BE] retry_download: exhausted {MAX_ATTEMPTS} attempts: {msg}");
                    if attempt > 1 {
                        emit_retrying(false);
                    }
                    return Err(exhausted_retry_error(msg));
                }

                log::warn!("[BE] retry_download: attempt {attempt}/{MAX_ATTEMPTS} failed: {msg}");
                tokio::time::sleep(Duration::from_millis(BACKOFF_BASE_MS * attempt as u64)).await;
            }
        }
    }

    unreachable!()
}

/// True for `ERR::` codes that are CDN-edge-scoped (error body tied to a
/// specific signed URL) and worth retrying with a re-fetched playurl URL.
/// All other `ERR::` codes are true business errors and stay non-retryable.
/// Whitelist intentionally minimal (issue #484).
fn is_retryable_err_code(msg: &str) -> bool {
    msg.contains("ERR::INVALID_MEDIA_RESPONSE")
}

/// Final error after exhausting all retry attempts. Only whitelisted
/// `ERR::` codes reach exhaustion (non-whitelisted ones return early);
/// they keep their semantic code while transient network messages are
/// wrapped as `ERR::NETWORK` (issue #484).
fn exhausted_retry_error(msg: String) -> String {
    if msg.contains("ERR::") {
        msg
    } else {
        format!("ERR::NETWORK::{msg}")
    }
}

/// Selects a stream URL from the quality list.
///
/// Searches for a stream matching the requested quality ID. If not found,
/// falls back to the best available quality (first item).
///
/// # Behavior Details
///
/// - If requested quality ID exists in the list, returns that stream
/// - If requested quality is not found, falls back to best quality (first)
/// - Specifying `-1` always selects best quality
/// - Backup URLs are also returned
///
/// # Arguments
///
/// * `items` - Slice of available video/audio streams
/// * `quality` - Requested quality ID (`-1` for best quality)
///
/// # Returns
///
/// Returns tuple `(primary_url, backup_urls, is_fallback)` on success:
/// - `primary_url` - Main stream URL
/// - `backup_urls` - List of backup URLs (if any)
/// - `is_fallback` - `true` if fallback occurred
///
/// # Errors
///
/// Returns `ERR::QUALITY_NOT_FOUND` if quality list is empty.
fn select_stream_url(
    items: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    quality: Option<i32>,
) -> Result<(String, Option<Vec<String>>, bool), String> {
    match quality {
        // Best effort: the user never picked a quality, so the expectation
        // is the HIGHEST available rendition — NOT the manifest's first
        // entry. Bilibili does not guarantee descending order (this bangumi
        // listed 1080p+ before HDR10, so `first()` auto-picked 1080p+).
        // Max id = highest rendition because quality ids are ordered
        // (127 8K > 126 Dolby > 125 HDR10 > … > 16 360p).
        None => items
            .iter()
            .max_by_key(|v| v.id)
            .map(|v| (v.base_url.clone(), v.backup_urls.clone(), false))
            .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into()),
        Some(qn) => items
            .iter()
            .find(|v| v.id == qn)
            .map(|v| (v.base_url.clone(), v.backup_urls.clone(), false))
            .or_else(|| {
                items
                    .first()
                    .map(|v| (v.base_url.clone(), v.backup_urls.clone(), true))
            })
            .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into()),
    }
}

/// Filters streams down to the requested quality when it exists (issue #584).
///
/// HDR10 (qn=125) and Dolby Vision (qn=126) are HEVC-only renditions, so an
/// AV1-first codec filter applied across the whole manifest would drop them
/// before quality selection ever runs. Scoping to the requested quality keeps
/// the codec fallback downward-only *within* that quality. Unknown or absent
/// quality (`None`) falls back to all streams — callers then rely on the
/// existing first-item (highest quality) fallback.
fn scope_streams_to_quality(
    video_streams: &[XPlayerApiResponseVideo],
    requested_quality: Option<i32>,
) -> Vec<XPlayerApiResponseVideo> {
    match requested_quality {
        Some(qn) if video_streams.iter().any(|v| v.id == qn) => video_streams
            .iter()
            .filter(|v| v.id == qn)
            .cloned()
            .collect(),
        _ => video_streams.to_vec(),
    }
}

/// Resolves the user's codec priority and filters video streams accordingly.
///
/// Reads the codec priority setting once and returns:
/// - The streams to use for quality selection: scoped to `requested_quality`
///   when that quality exists (see `scope_streams_to_quality`), then filtered
///   by the preferred codec — or all streams when the preferred codec is
///   unavailable for any quality (so the download never fails).
/// - The codec selection result, used by callers to detect codec fallback.
///   `None` means no priority codec was available at all (caller treats this
///   as a codec fallback for warning purposes).
///
/// Shared by `download_video` and `refetch_dash_urls` to keep the codec
/// selection logic in a single place.
/// Pure codec-priority-aware selection over an explicit codec
/// priority (the caller resolves it once per download — settings store is
/// Wry-coupled and lives in the real app-data dir, unreachable from tests).
fn select_streams_by_codec_priority_with(
    codec_priority: crate::utils::codec::VideoCodecPriority,
    video_streams: &[XPlayerApiResponseVideo],
    requested_quality: Option<i32>,
) -> (Vec<XPlayerApiResponseVideo>, Option<VideoStreamSelection>) {
    // Best effort (None): the highest rendition first — codec priority is
    // a tie-breaker WITHIN that rendition only. Scoping the codec filter
    // across the whole manifest capped unselected downloads at the best
    // stream of the preferred codec (AV1-first default → 1080p+) and
    // silently dropped higher HEVC-only renditions like HDR10 (qn=125).
    let quality_scoped = match requested_quality {
        None => {
            let max_id = video_streams.iter().map(|v| v.id).max();
            match max_id {
                Some(id) => video_streams
                    .iter()
                    .filter(|v| v.id == id)
                    .cloned()
                    .collect(),
                None => Vec::new(),
            }
        }
        Some(_) => scope_streams_to_quality(video_streams, requested_quality),
    };

    let available_codecs: Vec<i16> = quality_scoped.iter().map(|v| v.codecid).collect();
    let codec_selection = select_video_stream(&codec_priority, &available_codecs);

    let filtered: Vec<_> = quality_scoped
        .iter()
        .filter(|v| {
            codec_selection
                .as_ref()
                .map(|sel| v.codecid == sel.codecid)
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    if filtered.is_empty() {
        log::info!("[BE] no streams with preferred codec, using all streams");
        (quality_scoped, codec_selection)
    } else {
        (filtered, codec_selection)
    }
}

/// Response from Bilibili watch history API.
///
/// Contains paginated watch history entries with a cursor for fetching
/// subsequent pages.
///
/// # Fields
///
/// * `entries` - List of watch history entries with video metadata
/// * `cursor` - Pagination cursor for the next page request
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryResponse {
    pub entries: Vec<WatchHistoryEntry>,
    pub cursor: WatchHistoryCursor,
}

/// Fetches watch history from Bilibili with pagination support.
///
/// Uses cursor-based pagination to retrieve user's watch history from Bilibili API.
/// Requires valid authentication cookies.
///
/// # Pagination
///
/// Uses cursor-based pagination:
/// - Initial request: `max=0`, `view_at=0`
/// - Subsequent requests: Use `cursor.max`, `cursor.view_at` from previous response
///
/// Why: needs a live AppHandle with real Bilibili cookies; doctests run in CI
/// (rust-test job) and must stay hermetic
/// ```ignore
/// let first_page = fetch_watch_history(app, 0, 0).await?;
/// let next_page = fetch_watch_history(app, first_page.cursor.max, first_page.cursor.view_at).await?;
/// ```
///
/// # Arguments
///
/// * `app` - Tauri application handle for cookie cache access
/// * `max` - Maximum number of entries to retrieve (0 for default, usually 20)
/// * `view_at` - Timestamp cursor for pagination (0 for first page)
///
/// # Returns
///
/// Returns `WatchHistoryResponse`:
/// - `entries`: List of watch history entries with video metadata
/// - `cursor`: Pagination cursor for fetching next page
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Cookies unavailable (`ERR::COOKIE_MISSING`)
/// - User not logged in (`ERR::UNAUTHORIZED`)
/// - HTTP request failure
/// - Response parse failure
pub async fn fetch_watch_history(
    app: &AppHandle,
    max: i64,
    view_at: i64,
) -> Result<WatchHistoryResponse, String> {
    log::info!(
        "[BE] fetch_watch_history: requesting max={}, view_at={}",
        max,
        view_at
    );

    // 1. Get cookies (required)
    let cookies = read_cookie(app)?.unwrap_or_default();

    if cookies.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }

    let cookie_header = build_cookie_header(&cookies);

    let api = BiliApi::from_cookie_header(cookie_header)?;
    fetch_watch_history_with(&api, max, view_at).await
}

/// Transport-injectable core of [`fetch_watch_history`] (test seam).
async fn fetch_watch_history_with(
    api: &BiliApi,
    max: i64,
    view_at: i64,
) -> Result<WatchHistoryResponse, String> {
    // Omit parameters on first request; use max/view_at for subsequent pages
    let path = if max == 0 && view_at == 0 {
        "/x/web-interface/history/cursor?business=archive".to_string()
    } else {
        format!(
            "/x/web-interface/history/cursor?max={}&view_at={}&business=archive",
            max, view_at
        )
    };

    // Why: BiliApi::get status-checks the response, which this fetcher previously
    // skipped; a 429/5xx used to fall through to the JSON parse below and surface
    // as a parse error instead of ERR::RATE_LIMITED, the code the frontend maps
    // for rate-limit handling (src/shared/lib/mapBackendError.ts).
    let response = api.get(&path).await?;

    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response text: {e}"))?;

    let body: WatchHistoryApiResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Failed to parse watch history response: {e}. Response: {}",
            response_text
        )
    })?;

    // 3. Error handling (-101: not logged in)
    if body.code == -101 {
        return Err("ERR::UNAUTHORIZED".into());
    }

    if body.code != 0 {
        return Err(format!(
            "Watch history API error (code {}): {}",
            body.code, body.message
        ));
    }

    let data = body
        .data
        .ok_or_else(|| "Watch history API returned no data".to_string())?;

    // 4. DTO conversion (encode thumbnails to Base64 in parallel)
    let entry_futures: Vec<_> = data
        .list
        .into_iter()
        .map(|item| {
            let url = if item.history.page > 1 {
                format!(
                    "https://www.bilibili.com/video/{}?p={}",
                    item.history.bvid, item.history.page
                )
            } else {
                format!("https://www.bilibili.com/video/{}", item.history.bvid)
            };

            async move {
                WatchHistoryEntry {
                    title: item.title,
                    cover: item.cover,
                    bvid: item.history.bvid,
                    cid: item.history.cid,
                    page: item.history.page,
                    view_at: item.view_at,
                    duration: item.duration,
                    progress: item.progress,
                    url,
                }
            }
        })
        .collect();

    let entries = futures::future::join_all(entry_futures).await;

    let cursor = WatchHistoryCursor {
        view_at: data.cursor.view_at,
        max: data.cursor.max,
        is_end: data.cursor.is_end,
    };

    Ok(WatchHistoryResponse { entries, cursor })
}

/// Searches bilibili videos by keyword (`search_type=video`, 20 per page).
///
/// Works logged out: the endpoint needs only a `buvid3` device cookie plus
/// WBI signing (no SESSDATA personalization — results are identical logged
/// in). When the cookie cache lacks `buvid3`, one is fetched via the login
/// flow's Spirite endpoint and cached for the process lifetime.
///
/// `filters` carries the bilibili video-search filter params (order /
/// duration / tids); invalid values normalize to the bilibili defaults.
///
/// Error codes: `ERR::SEARCH_KEYWORD_EMPTY` (blank keyword),
/// `ERR::RATE_LIMITED` (API -412 or HTTP 429), `ERR::API_ERROR` (other HTTP
/// failures), or a `Search API error (code …)` string for API-level errors.
pub async fn search_videos(
    app: &AppHandle,
    keyword: &str,
    page: i64,
    filters: Option<SearchFilters>,
) -> Result<SearchResponse, String> {
    log::info!("[BE] search_videos: keyword={:?}, page={}", keyword, page);
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err("ERR::SEARCH_KEYWORD_EMPTY".into());
    }

    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    // Anonymous (logged-out) search: the cookie cache carries no device
    // fingerprint — search_videos_anon fetches a FRESH buvid3 per request
    // (risk score accumulates per device id; see its doc comment) and runs
    // the whole lifecycle on the curl transport.
    let anonymous = !header
        .split(';')
        .any(|c| c.trim_start().starts_with("buvid3="));

    if anonymous {
        let base = BiliApi::from_cookie_header("")?.base;
        let result = search_videos_anon(&base, keyword, page, filters.as_ref()).await;
        if let Err(e) = &result {
            log::warn!("[BE] search_videos: failed: {e}");
        }
        return result;
    }

    let api = BiliApi::from_cookie_header(header)?;
    let result = search_videos_with(&api, keyword, page, filters.as_ref()).await;
    // Why: surface the failing stage (mixin key / HTTP status / parse) in
    // app.log — the first manual verification hit a parse error that was
    // invisible without this line.
    if let Err(e) = &result {
        log::warn!("[BE] search_videos: failed: {e}");
    }
    result
}

/// Builds the WBI-signed query pairs for the video-search endpoint.
fn signed_search_query(
    mixin_key: &str,
    keyword: &str,
    page: i64,
    filters: Option<&SearchFilters>,
) -> Result<Vec<(String, String)>, String> {
    let page = page.max(1);

    let f = filters.cloned().unwrap_or_default();
    // Whitelist of the documented video-search sort values; anything else
    // (including None) falls back to the API default.
    const SEARCH_ORDERS: [&str; 5] = ["totalrank", "click", "pubdate", "dm", "stow"];
    let order = f
        .order
        .as_deref()
        .filter(|o| SEARCH_ORDERS.contains(o))
        .unwrap_or("totalrank");
    // Why: the API defines duration buckets 0-4 (0 all … 4 >60min) and
    // tids=0 as "all zones" — clamping keeps out-of-range frontend values
    // inside the documented filter semantics
    // (references/bilibili-API-collect/docs/search/search_request.md).
    let duration = f.duration.unwrap_or(0).clamp(0, 4);
    let tids = f.tids.unwrap_or(0).max(0);

    let mut params = std::collections::BTreeMap::from([
        ("search_type".to_string(), "video".to_string()),
        ("keyword".to_string(), keyword.to_string()),
        ("page".to_string(), page.to_string()),
        ("order".to_string(), order.to_string()),
        ("duration".to_string(), duration.to_string()),
        ("tids".to_string(), tids.to_string()),
    ]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, mixin_key);
    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs); only w_rid is appended — same pattern as
    // fetch_wbi_view. Sending wts twice makes wbi endpoints return v_voucher.
    let mut query: Vec<(String, String)> = params.into_iter().collect();
    query.push(("w_rid".to_string(), signature.w_rid));
    Ok(query)
}

/// Parses and maps a `wbi/search/type` response body into the frontend DTO.
///
/// Extracted from the reqwest seam so the curl-based anonymous transport
/// reuses the exact same code-mapping and entry-shaping logic.
fn parse_search_response(response_text: &str, page: i64) -> Result<SearchResponse, String> {
    let page = page.max(1);
    let body: SearchApiResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("Failed to parse search response: {e}. Response: {response_text}"))?;

    if body.code == -412 {
        return Err("ERR::RATE_LIMITED".into());
    }
    if body.code != 0 {
        return Err(format!(
            "Search API error (code {}): {}",
            body.code, body.message
        ));
    }

    // `data` is absent only on error bodies; treat it as an empty page so a
    // malformed-but-code-0 response degrades to "no results" instead of an
    // error screen.
    let data = body.data.unwrap_or(SearchApiData {
        page,
        num_results: 0,
        num_pages: 0,
        result: Vec::new(),
    });

    Ok(SearchResponse {
        page: data.page,
        num_results: data.num_results,
        num_pages: data.num_pages,
        // Why: the result list can carry ad/interference rows with an empty
        // bvid (observed on the live API); they are undownloadable.
        entries: data
            .result
            .into_iter()
            .filter(|item| !item.bvid.is_empty())
            .map(|item| {
                let duration = duration_seconds(item.duration.as_ref());
                SearchResultEntry {
                    title: unescape_title_entities(&strip_keyword_em_tags(&item.title)),
                    cover: normalize_cover_url(&item.pic),
                    bvid: item.bvid,
                    author: item.author,
                    play: item.play,
                    duration,
                    typeid: item.typeid,
                    typename: item.typename,
                    recommend_reason: None,
                }
            })
            .collect(),
    })
}

/// Transport-injectable core of [`search_videos`] (test seam).
async fn search_videos_with(
    api: &BiliApi,
    keyword: &str,
    page: i64,
    filters: Option<&SearchFilters>,
) -> Result<SearchResponse, String> {
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;
    let query = signed_search_query(&mixin_key, keyword, page, filters)?;
    let borrowed: Vec<(&str, String)> =
        query.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    let response = api
        .get_q("/x/web-interface/wbi/search/type", &borrowed)
        .await?;
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read search response text: {e}"))?;
    parse_search_response(&response_text, page)
}

/// GETs `url` via the system `curl` and returns the response body.
///
/// Why a subprocess: bilibili's risk control probabilistically degrades
/// ANONYMOUS `wbi/search/type` responses to an empty result list for this
/// app's reqwest TLS stacks (native-tls AND rustls, HTTP/1.1 AND h2 — all
/// verified failing against the live API on 2026-10-04), while OS-tool TLS
/// shapes pass consistently (curl: 3/3, python-urllib: 12/12, same
/// cookies/signing/IP/headers). Logged-in requests are unaffected. A spawn
/// failure (no curl on PATH) is returned as Err so the caller can fall
fn curl_args(url: &str, cookie_header: &str) -> Vec<String> {
    // Why the Cookie header is conditional: sending an EMPTY `Cookie:`
    // header marks the client as a script to bilibili's risk control and
    // challenges the follow-up search with v_voucher (observed live
    // 2026-10-04) — cookie-less requests must omit the header entirely.
    let mut args = vec![
        "-sS".to_string(),
        "--max-time".to_string(),
        "15".to_string(),
        "-H".to_string(),
        format!("User-Agent: {USER_AGENT}"),
        "-H".to_string(),
        format!("Referer: {REFERER}"),
    ];
    if !cookie_header.is_empty() {
        args.push("-H".to_string());
        args.push(format!("Cookie: {cookie_header}"));
    }
    args.push(url.to_string());
    args
}

/// GETs `url` via the system `curl` and returns the response body.
async fn fetch_url_via_curl(url: &str, cookie_header: &str) -> Result<String, String> {
    use tokio::process::Command as AsyncCommand;

    // Why absolute on macOS: PATH resolution inside the dev/bundle process
    // can pick a non-system curl build whose TLS shape bilibili's risk
    // control flags; /usr/bin/curl (LibreSSL) is the verified-passing one.
    #[cfg(target_os = "macos")]
    let curl = "/usr/bin/curl";
    #[cfg(not(target_os = "macos"))]
    let curl = "curl";

    let mut cmd = AsyncCommand::new(curl);
    cmd.args(curl_args(url, cookie_header));
    {
        // Same CREATE_NO_WINDOW discipline as every external process in
        // handlers/ (e.g. gif.rs) — without it a console window pops up on
        // Windows release builds.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to spawn curl: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "curl exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Anonymous (logged-out) video search over the curl transport.
///
/// Why fresh buvid3 per request: bilibili's risk score accumulates per
/// device id — a process-lifetime cached buvid3 degrades to empty results
/// and eventually a `v_voucher` captcha challenge (observed live
/// 2026-10-04), while every probe with a freshly issued buvid3 returned
/// full results (~15/15). Each attempt therefore fetches its own device
/// id; one retry with a brand-new id rides out a transient degrade.
///
/// Falls back to the reqwest seam when curl is unavailable so the feature
/// degrades to the previous behavior instead of erroring.
async fn search_videos_anon(
    base: &str,
    keyword: &str,
    page: i64,
    filters: Option<&SearchFilters>,
) -> Result<SearchResponse, String> {
    match search_videos_anon_with(
        |url, cookie| Box::pin(fetch_url_via_curl(url, cookie)),
        base,
        keyword,
        page,
        filters,
    )
    .await
    {
        // None = curl transport unavailable → fall back to the reqwest
        // seam (the pre-curl behavior) instead of erroring.
        Ok(Some(resp)) => Ok(resp),
        Ok(None) => {
            log::warn!("[BE] search_videos: curl transport unavailable — falling back to reqwest");
            let api = BiliApi::from_cookie_header(String::new())?;
            search_videos_with(&api, keyword, page, filters).await
        }
        Err(e) => Err(e),
    }
}

/// Transport-injectable core of [`search_videos_anon`] (test seam).
///
/// `fetch` maps `(url, cookie_header)` to the response body — the
/// production closure shells out to curl (see [`fetch_url_via_curl`]);
/// tests inject canned bodies. Returns `Ok(None)` when the transport
/// itself is unavailable (spawn failure) so the caller can fall back.
async fn search_videos_anon_with<F>(
    fetch: F,
    base: &str,
    keyword: &str,
    page: i64,
    filters: Option<&SearchFilters>,
) -> Result<Option<SearchResponse>, String>
where
    // Boxed borrow-carrying future: a plain `-> Fut` bound cannot express
    // the higher-ranked borrow a Fn over borrowed URLs needs (E0106/E0277).
    F: for<'a> Fn(
        &'a str,
        &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + 'a + Send>>,
{
    for attempt in 0..3 {
        // Why spi over the same transport too: a buvid3 ISSUED to the
        // reqwest TLS class gets flagged server-side and every later
        // request carrying it degrades — the anonymous lifecycle stays on
        // one transport.
        let spi_body = match fetch(&format!("{base}/x/frontend/finger/spi"), "").await {
            Ok(b) => b,
            Err(_) => return Ok(None),
        };
        let b3 = serde_json::from_str::<serde_json::Value>(&spi_body)
            .ok()
            .and_then(|v| {
                v.pointer("/data/b_3")
                    .and_then(|b| b.as_str())
                    .map(str::to_string)
            })
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "Failed to parse buvid3 from spi response".to_string())?;
        let cookie = format!("buvid3={b3}");

        // Nav needs no cookie; same-transport fetch keeps the lifecycle
        // uniform (mixin key derivation via wbi::mixin_key_from_nav_body).
        let nav_body = match fetch(&format!("{base}/x/web-interface/nav"), "").await {
            Ok(b) => b,
            Err(_) => return Ok(None),
        };
        let nav: serde_json::Value = serde_json::from_str(&nav_body)
            .map_err(|e| format!("Failed to parse nav response: {e}"))?;
        let mixin_key = crate::utils::wbi::mixin_key_from_nav_body(&nav)?;

        let query = signed_search_query(&mixin_key, keyword, page, filters)?;
        // Why: form-encoding percent-encodes reserved characters (`&`,
        // spaces) in signed params / keywords — same constraint as get_q,
        // whose reqwest encoder does this implicitly.
        let qs = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(query.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .finish();
        let url = format!("{base}/x/web-interface/wbi/search/type?{qs}");

        let body = match fetch(&url, &cookie).await {
            Ok(b) => b,
            Err(_) => return Ok(None),
        };
        let resp = parse_search_response(&body, page)?;
        // Degrade markers: a `v_voucher` captcha challenge, or a page-0
        // body for a page≥1 request (real responses echo the page back).
        let degraded = body.contains("\"v_voucher\"") || (resp.page == 0 && page.max(1) >= 1);
        if !degraded || attempt == 2 {
            return Ok(Some(resp));
        }
        log::warn!(
            "[BE] search_videos: anonymous response degraded (v_voucher/empty) — retrying with a fresh buvid3"
        );
    }
    unreachable!("retry loop returns on its final iteration")
}

/// Page size of the popular-feed requests; 20 matches the search page's
/// grid (the API accepts up to 50 per its docs).
const POPULAR_PAGE_SIZE: i64 = 20;

/// Fetches the popular (综合热门) video feed — the search page's default
/// entry view before the first keyword search (bilibili-official behavior).
///
/// Works logged out (no WBI signing, no buvid3 — verified against the live
/// API, unlike `wbi/search/type` this endpoint does not degrade anonymous
/// reqwest requests). Logged-in users get a personalized ranking (cookie
/// header rides `BiliApi` automatically).
///
/// Reuses the search DTO: `num_results` is 0 (the feed reports no total;
/// this keeps the filter bar's result-count chip hidden) and `num_pages`
/// is synthesized from `no_more` with "has next page" semantics.
///
/// Error codes: `ERR::RATE_LIMITED` (API -412 or HTTP 429),
/// `ERR::API_ERROR` (other HTTP failures), or a freeform parse/API string.
pub async fn fetch_popular_videos(app: &AppHandle, page: i64) -> Result<SearchResponse, String> {
    log::info!("[BE] fetch_popular_videos: page={}", page.max(1));
    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    let api = BiliApi::from_cookie_header(header)?;
    let result = fetch_popular_videos_with(&api, page).await;
    if let Err(e) = &result {
        log::warn!("[BE] fetch_popular_videos: failed: {e}");
    }
    result
}

/// Transport-injectable core of [`fetch_popular_videos`] (test seam).
async fn fetch_popular_videos_with(api: &BiliApi, page: i64) -> Result<SearchResponse, String> {
    let page = page.max(1);
    let response = api
        .get_q(
            "/x/web-interface/popular",
            &[
                ("ps", POPULAR_PAGE_SIZE.to_string()),
                ("pn", page.to_string()),
            ],
        )
        .await?;
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read popular response text: {e}"))?;
    parse_popular_response(&response_text, page)
}

/// Parses and maps a `popular` response body into the frontend search DTO.
fn parse_popular_response(response_text: &str, page: i64) -> Result<SearchResponse, String> {
    let body: PopularApiResponse = serde_json::from_str(response_text)
        .map_err(|e| format!("Failed to parse popular response: {e}. Response: {response_text}"))?;

    if body.code == -412 {
        return Err("ERR::RATE_LIMITED".into());
    }
    if body.code != 0 {
        return Err(format!(
            "Popular API error (code {}): {}",
            body.code, body.message
        ));
    }

    // `data` is absent only on error bodies; treat it as an empty page so a
    // malformed-but-code-0 response degrades to "no recommendations"
    // instead of an error screen (same policy as the search parser).
    let data = body.data.unwrap_or_default();

    Ok(SearchResponse {
        page,
        num_results: 0,
        num_pages: if data.no_more { page } else { page + 1 },
        entries: data
            .list
            .into_iter()
            // Ad/interference rows carry an empty bvid (same filter as search).
            .filter(|item| !item.bvid.is_empty())
            .map(|item| SearchResultEntry {
                title: item.title,
                cover: normalize_cover_url(&item.pic),
                bvid: item.bvid,
                author: item.owner.name,
                play: item.stat.view,
                // Already integer seconds on this API (search sends "M:S").
                duration: item.duration,
                typeid: item.tid.to_string(),
                typename: item.tname,
                recommend_reason: None,
            })
            .collect(),
    })
}

/// Signed query for the home feed — web-home defaults from the API docs
/// (fresh_type=4 = most relevant; ps=12 fills the featured grid once).
fn signed_home_feed_query(mixin_key: &str) -> Vec<(String, String)> {
    let mut params = std::collections::BTreeMap::from([
        ("fresh_type".to_string(), "4".to_string()),
        ("ps".to_string(), "12".to_string()),
        ("fresh_idx".to_string(), "1".to_string()),
        ("fresh_idx_1h".to_string(), "1".to_string()),
        ("brush".to_string(), "1".to_string()),
        ("fetch_row".to_string(), "1".to_string()),
        ("web_location".to_string(), "1430650".to_string()),
    ]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, mixin_key);
    // generate_wbi_signature already inserted wts (see signed_search_query).
    let mut query: Vec<(String, String)> = params.into_iter().collect();
    query.push(("w_rid".to_string(), signature.w_rid));
    query
}

/// Parses a home-feed body into featured entries: keeps `goto == "av"`
/// rows without `business_info` (drops live/ogv/ad rows), caps at 12.
fn parse_home_feed_response(response_text: &str) -> Result<Vec<SearchResultEntry>, String> {
    let body: crate::models::bilibili_api::HomeFeedApiResponse =
        serde_json::from_str(response_text)
            .map_err(|e| format!("Failed to parse home feed response: {e}"))?;
    if body.code != 0 {
        return Err(format!(
            "Home feed API error (code {}): {}",
            body.code, body.message
        ));
    }
    let items = body.data.map(|d| d.item).unwrap_or_default();
    Ok(items
        .into_iter()
        // Why: live/ogv/ad rows are not downloadable videos and this shelf
        // feeds the same download-hand-off card grid as search/popular.
        .filter(|i| i.goto == "av" && i.business_info.is_none())
        .take(12)
        .map(|i| SearchResultEntry {
            bvid: i.bvid,
            title: i.title,
            cover: normalize_cover_url(&i.pic),
            author: i.owner.map(|o| o.name).unwrap_or_default(),
            play: i.stat.map(|s| s.view).unwrap_or(0),
            duration: i.duration,
            // feed/rcmd items carry no zone (tid/tname) — empty strings keep
            // the existing ZoneBadge-hidden behavior.
            typeid: String::new(),
            typename: String::new(),
            recommend_reason: i
                .rcmd_reason
                .and_then(|r| (!r.content.is_empty()).then_some(r.content)),
        })
        .collect())
}

/// Fetches the personalized web-home recommendation feed for logged-in
/// users. Decorative shelf: logged-out and ANY fetch failure return an
/// empty vector (never an error) so the frontend can uniformly hide the
/// section while the popular feed below keeps its own error handling.
pub async fn fetch_home_recommendations(app: &AppHandle) -> Result<Vec<SearchResultEntry>, String> {
    // Both steps below can fail (cache state inaccessible, client build);
    // per the never-error contract they degrade to an empty shelf too.
    let header = match read_cookie(app) {
        Ok(cookies) => build_cookie_header(&cookies.unwrap_or_default()),
        Err(e) => {
            log::warn!("[BE] fetch_home_recommendations: failed to read cookies: {e}");
            return Ok(Vec::new());
        }
    };
    // Why: /x/web-interface/wbi/index/top/feed/rcmd is personalized only
    // when logged in (SESSDATA cookie) — anonymous requests yield no
    // recommendations, so skip the round-trip and return the empty shelf.
    let logged_in = header
        .split(';')
        .any(|c| c.trim_start().starts_with("SESSDATA="));
    if !logged_in {
        return Ok(Vec::new());
    }
    log::info!("[BE] fetch_home_recommendations: fetching web-home feed");
    let api = match BiliApi::from_cookie_header(header) {
        Ok(api) => api,
        Err(e) => {
            log::warn!("[BE] fetch_home_recommendations: failed: {e}");
            return Ok(Vec::new());
        }
    };
    let result = fetch_home_recommendations_with(&api).await;
    if let Err(e) = &result {
        log::warn!("[BE] fetch_home_recommendations: failed: {e}");
    }
    Ok(result.unwrap_or_default())
}

/// Transport-injectable core of [`fetch_home_recommendations`] (test seam).
async fn fetch_home_recommendations_with(api: &BiliApi) -> Result<Vec<SearchResultEntry>, String> {
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;
    let query = signed_home_feed_query(&mixin_key);
    let borrowed: Vec<(&str, String)> =
        query.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    let response = api
        .get_q("/x/web-interface/wbi/index/top/feed/rcmd", &borrowed)
        .await?;
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read home feed response text: {e}"))?;
    parse_home_feed_response(&response_text)
}

/// Origin of the suggest API (lives outside api.bilibili.com).
const SUGGEST_BASE: &str = "https://s.search.bilibili.com";

/// Fetches search keyword suggestions for a partial input.
///
/// Wraps `https://s.search.bilibili.com/main/suggest` (up to 10 keywords,
/// CJK/pinyin aware). No login and no WBI signing required — the endpoint is
/// open (verified against the live API). Suggestions are best-effort: a
/// failed fetch returns an empty list so typing never surfaces an error.
pub async fn search_suggest(app: &AppHandle, keyword: &str) -> Result<Vec<String>, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Ok(Vec::new());
    }
    log::info!("[BE] search_suggest: keyword={:?}", keyword);

    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    // Why: reuse the shared transport (UA/timeout/E2E override) but point it
    // at the suggest origin; the cookie header rides along when logged in.
    let api = BiliApi::from_cookie_header(header)?.with_base(SUGGEST_BASE.to_string());

    search_suggest_with(&api, keyword).await
}

/// Transport-injectable core of [`search_suggest`] (test seam).
async fn search_suggest_with(api: &BiliApi, keyword: &str) -> Result<Vec<String>, String> {
    // Why: get_q percent-encodes the term (CJK/reserved chars) instead of
    // format!-embedding raw bytes into the path.
    let Ok(response) = api
        .get_q("/main/suggest", &[("term", keyword.to_string())])
        .await
    else {
        // Best-effort: any transport failure degrades to "no suggestions"
        // instead of an error the page would surface mid-typing.
        return Ok(Vec::new());
    };
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read suggest response text: {e}"))?;
    let body: SuggestApiResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse suggest response: {e}. Response: {text}"))?;
    if body.code != 0 {
        return Ok(Vec::new());
    }
    Ok(body
        .result
        .map(|r| r.tag.into_iter().map(|t| t.value).collect())
        .unwrap_or_default())
}

/// A bilibili hot-search (trending) keyword.
///
/// `keyword` is the value to feed back into a search; `show_name` is the
/// display string (occasionally longer than the keyword).
/// Why camelCase: this struct is the IPC wire format — the shape must match
/// the TS `TrendingKeyword` interface
/// (src/features/video-search/api/searchTrending.ts).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendingKeyword {
    pub keyword: String,
    pub show_name: String,
}

/// How many trending keywords to request (the web dropdown shows 10).
const TRENDING_LIMIT: u32 = 10;

/// Raw body of `/x/web-interface/wbi/search/square`.
#[derive(Deserialize)]
struct SearchSquareResponse {
    code: i64,
    #[serde(default)]
    data: Option<SearchSquareData>,
}

#[derive(Deserialize)]
struct SearchSquareData {
    #[serde(default)]
    trending: Option<SearchSquareTrending>,
}

#[derive(Deserialize)]
struct SearchSquareTrending {
    #[serde(default)]
    list: Vec<SearchSquareItem>,
}

#[derive(Deserialize)]
struct SearchSquareItem {
    keyword: String,
    #[serde(default)]
    show_name: Option<String>,
}

/// Fetches the bilibili hot-search (trending) keyword list.
///
/// Wraps the WBI-signed `GET /x/web-interface/wbi/search/square` endpoint
/// (references/bilibili-API-collect/docs/search/hot.md). Works logged out —
/// same transport/cookie posture as `search_suggest`. Best-effort like
/// `search_suggest`: transport failures, mixin-key failures, and API-level
/// errors degrade to an empty list instead of surfacing on the search page.
pub async fn search_trending(app: &AppHandle) -> Result<Vec<TrendingKeyword>, String> {
    log::info!("[BE] search_trending");
    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    let api = BiliApi::from_cookie_header(header)?;
    search_trending_with(&api).await
}

/// Transport-injectable core of [`search_trending`] (test seam).
async fn search_trending_with(api: &BiliApi) -> Result<Vec<TrendingKeyword>, String> {
    let mixin_key = match crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await
    {
        Ok(k) => k,
        Err(e) => {
            // Best-effort panel: no key → no list, never an error.
            log::warn!("[BE] search_trending: mixin key fetch failed: {e}");
            return Ok(Vec::new());
        }
    };

    let mut params =
        std::collections::BTreeMap::from([("limit".to_string(), TRENDING_LIMIT.to_string())]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);
    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs); only w_rid is appended — same pattern as
    // signed_search_query. Sending wts twice makes wbi endpoints return
    // v_voucher.
    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));

    let Ok(response) = api
        .get_q("/x/web-interface/wbi/search/square", &query)
        .await
    else {
        // Best-effort: any transport failure degrades to "no trending list".
        return Ok(Vec::new());
    };
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read trending response text: {e}"))?;
    let body: SearchSquareResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse trending response: {e}. Response: {text}"))?;
    if body.code != 0 {
        log::warn!("[BE] search_trending: API code {}", body.code);
        return Ok(Vec::new());
    }
    Ok(body
        .data
        .and_then(|d| d.trending)
        .map(|t| {
            t.list
                .into_iter()
                .map(|i| TrendingKeyword {
                    keyword: i.keyword.clone(),
                    show_name: i.show_name.unwrap_or(i.keyword),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Fetches available subtitles for a video part from Player v2 API.
///
/// Retrieves subtitle information using Bilibili Player v2 API.
/// Returns an empty vector on error or when no subtitles are available (does not propagate errors).
///
/// # Arguments
///
/// * `client` - HTTP client
/// * `cookies` - Cookie entries for authentication
/// * `bvid` - Bilibili video ID
/// * `cid` - Content ID
///
/// # Returns
///
/// Returns a list of available subtitles.
/// Returns an empty vector if no subtitles exist or on error.
///
/// # Notes
///
/// - Uses `/x/player/wbi/v2` with WBI signature + Cookie authentication.
///   The unsigned `/x/player/v2` endpoint returns stale CDN cache with a
///   partial AI subtitle set; the signed endpoint returns the full set
///   in one request.
/// - Requires login (SESSDATA cookie) to retrieve subtitle data
/// - Determines if subtitle is AI-generated via the URL path containing `/ai_subtitle/`
pub(crate) async fn fetch_subtitles(api: &BiliApi, bvid: &str, cid: i64) -> Vec<SubtitleDto> {
    log::info!(
        "[BE] fetch_subtitles: starting for bvid={}, cid={}",
        bvid,
        cid
    );

    if api.cookie_header.is_empty() {
        log::warn!(
            "[BE] fetch_subtitles: no cookies available, \
             subtitles require login"
        );
        return Vec::new();
    }

    let client = &api.http;
    let cookie_header = api.cookie_header.clone();

    // WBI-signed access. The unsigned `/x/player/v2` endpoint is
    // unreliable: Bilibili's CDN returns stale cached responses that
    // contain only a partial AI subtitle set. The signed `/wbi/v2`
    // endpoint returns the full set in a single request.
    let mixin_key =
        match crate::utils::wbi::fetch_mixin_key(client, &api.base, Some(&cookie_header)).await {
            Ok(k) => k,
            Err(e) => {
                log::error!("[BE] fetch_subtitles: failed to fetch WBI mixin key: {}", e);
                return Vec::new();
            }
        };

    let (id_key, id_val) = wbi_video_param(bvid);
    let mut params = BTreeMap::from([
        (id_key.to_string(), id_val),
        ("cid".to_string(), cid.to_string()),
    ]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs) and this query is built from `params`, so
    // pushing wts again would send the pair twice; wbi endpoints return
    // v_voucher when wts/w_rid are missing or wrong
    // (references/bilibili-API-collect/docs/misc/sign/wbi.md)
    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));

    // Transport errors (send failure or non-2xx status) both soft-fail here.
    let response = match api.get_q("/x/player/wbi/v2", &query).await {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("[BE] fetch_subtitles: request failed: {e}");
            return Vec::new();
        }
    };

    let body: PlayerV2ApiResponse = match response.json().await {
        Ok(b) => b,
        Err(e) => {
            log::error!("[BE] fetch_subtitles: failed to parse JSON: {}", e);
            return Vec::new();
        }
    };

    if body.code != 0 {
        log::error!(
            "[BE] fetch_subtitles: API error code={}, \
             message={:?}",
            body.code,
            body.message
        );
        return Vec::new();
    }

    let subtitles = body
        .data
        .and_then(|d| d.subtitle)
        .and_then(|s| s.subtitles)
        .unwrap_or_default();

    log::info!(
        "[BE] fetch_subtitles: retrieved {} subtitles for \
         bvid={}, cid={}",
        subtitles.len(),
        bvid,
        cid
    );

    subtitles
        .into_iter()
        .map(|item| {
            let is_ai = item.subtitle_url.contains("/ai_subtitle/");
            SubtitleDto {
                lan: item.lan,
                lan_doc: item.lan_doc,
                subtitle_url: item.subtitle_url,
                is_ai,
                ai_type: item.ai_type,
            }
        })
        .collect()
}

/// Fetches available subtitles for a specific video part.
///
/// Used for lazy loading when user opens the subtitle accordion in the UI.
///
/// # Arguments
///
/// * `app` - Tauri application handle for cookie cache access
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID
///
/// # Returns
///
/// Returns a list of available subtitles with language info and URLs.
/// Returns an empty vector if no subtitles are available or on error.
///
/// Uses the WBI-signed [`fetch_subtitles`], which returns the full
/// subtitle set in a single request.
pub async fn fetch_subtitles_for_part(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
) -> Result<Vec<SubtitleDto>, String> {
    log::info!(
        "[BE] fetch_subtitles_for_part: requesting \
         subtitles for bvid={}, cid={}",
        bvid,
        cid
    );
    let cookies = read_cookie(app)?.unwrap_or_default();
    let api = BiliApi::from_cookies(&cookies)?;
    let subtitles = fetch_subtitles(&api, bvid, cid).await;

    log::info!(
        "[BE] fetch_subtitles_for_part: received {} subtitles",
        subtitles.len()
    );
    Ok(subtitles)
}

/// Fetches available video and audio qualities for a specific part.
///
/// Used for lazy loading when parts are rendered in the UI
/// (virtual scrolling optimization).
///
/// # Supported Formats
///
/// - **DASH format**: Returns both video and audio quality lists when streams are separated
/// - **durl format**: Returns video quality only when audio is embedded, audio quality list is empty
///
/// # Arguments
///
/// * `app` - Tauri application handle for cookie cache access
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID
///
/// # Returns
///
/// Returns `(video_qualities, audio_qualities, audio_absent)` tuple:
/// - `video_qualities` - List of available video qualities
/// - `audio_qualities` - List of available audio qualities (empty for durl format)
/// - `audio_absent` - True when the source video has no audio track at all
///   (DASH manifest with video streams but `audio: null`, issue #446) —
///   distinct from durl format where audio is embedded in the file
pub async fn fetch_part_qualities(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>, bool), String> {
    log::info!(
        "[BE] fetch_part_qualities: requesting qualities for bvid={}, cid={}",
        bvid,
        cid
    );
    let cookies = read_cookie(app)?.unwrap_or_default();
    let api = BiliApi::from_cookies(&cookies)?;
    fetch_part_qualities_with(&api, bvid, cid).await
}

/// Transport-injectable core of [`fetch_part_qualities`] (test seam).
async fn fetch_part_qualities_with(
    api: &BiliApi,
    bvid: &str,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>, bool), String> {
    let details = fetch_video_details(api, bvid, cid).await?;
    let data = details.data.ok_or("ERR::NO_STREAM")?;

    // DASH format: separate video and audio streams
    if let Some(dash) = data.dash {
        let selectable_audio = dash.selectable_audio();
        let video_qualities = convert_qualities(&dash.video, video_quality_rank);
        let audio_qualities = convert_qualities(&selectable_audio, audio_quality_rank);
        // Silent source (issue #446): video streams exist but the manifest
        // carries no audio track at all.
        let audio_absent = !dash.video.is_empty() && selectable_audio.is_empty();
        log::info!(
            "[BE] fetch_part_qualities: received {} video qualities, {} audio qualities (audio_absent={})",
            video_qualities.len(),
            audio_qualities.len(),
            audio_absent
        );
        return Ok((video_qualities, audio_qualities, audio_absent));
    }

    // durl format: audio is embedded in video, derive qualities from
    // support_formats
    if let Some(formats) = data.support_formats {
        let video_qualities: Vec<Quality> = formats
            .iter()
            .map(|f| Quality {
                id: f.quality,
                codecid: 0,
                quality: first_non_empty(&[&f.new_description, &f.display_desc, &f.description])
                    .unwrap_or_else(|| quality_to_string(&f.quality)),
            })
            .collect();
        // durl format has no separate audio stream (it is embedded)
        return Ok((video_qualities, vec![], false));
    }

    Err("ERR::NO_STREAM".to_string())
}

/// Resolves a directly playable MP4 URL for previewing a search result.
///
/// Search-to-download sanity check: lets the user sample the video before
/// committing to a download. Requests the HTML5 playurl variant
/// (`platform=html5`), which returns a single muxed MP4 (audio embedded)
/// with no referer hotlink protection, so the frontend can feed a plain
/// `<video>` element without a proxy. Quality is capped server-side at
/// 1080p (`high_quality=1`); VIP-only tiers are DASH-only and out of scope
/// by design — entitlements stay enforced by the API either way.
///
/// Works logged out (`try_look=1` mirrors the official logged-out player)
/// and sends the cached Cookie header when present so logged-in users get
/// the full 1080p preview.
///
/// # Errors
///
/// Returns an error if:
/// - Video is not found (`ERR::VIDEO_NOT_FOUND`)
/// - No MP4 stream is returned (`ERR::NO_STREAM`)
pub async fn get_preview_play_url(app: &AppHandle, bvid: &str) -> Result<String, String> {
    log::info!(
        "[BE] get_preview_play_url: requesting preview for bvid={}",
        bvid
    );
    let cookies = read_cookie(app)?.unwrap_or_default();
    let api = BiliApi::from_cookies(&cookies)?;
    let result = get_preview_play_url_with(&api, bvid).await;
    if let Err(e) = &result {
        // Why: the stages above return ERR::* codes to the FE silently,
        // which left app.log with "requesting" entries and no outcome —
        // preview failures were undiagnosable from the log alone.
        log::warn!("[BE] get_preview_play_url: failed for bvid={bvid}: {e}");
    }
    result
}

/// Transport-injectable core of [`get_preview_play_url`] (test seam).
async fn get_preview_play_url_with(api: &BiliApi, bvid: &str) -> Result<String, String> {
    // The preview always samples page 1: the WBI view response reports its
    // cid at the data root (equal to pages[0].cid for multi-part videos).
    let view = fetch_wbi_view(api, bvid).await?;
    let cid = view.data.map(|d| d.cid).unwrap_or_default();

    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        &api.base,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;

    let (id_key, id_val) = wbi_video_param(bvid);
    let mut params = BTreeMap::from([
        (id_key.to_string(), id_val),
        ("cid".to_string(), cid.to_string()),
        ("qn".to_string(), "64".to_string()),
        // Why: fnval=1 requests the legacy MP4 (durl) container, mutually
        // exclusive with the DASH shape (fnval=16) the download path uses
        // — a plain <video> element cannot play separate DASH tracks
        // (references/bilibili-API-collect/docs/video/videostream_url.md).
        ("fnval".to_string(), "1".to_string()),
        ("fnver".to_string(), "0".to_string()),
        // HTML5 platform = one muxed MP4, no referer hotlink check
        // (references/bilibili-API-collect/docs/video/videostream_url.md).
        ("platform".to_string(), "html5".to_string()),
        ("high_quality".to_string(), "1".to_string()),
        // Official logged-out player param: guests get 720p/1080p instead
        // of the 480p cap; ignored server-side when SESSDATA is present.
        ("try_look".to_string(), "1".to_string()),
    ]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    // Why: generate_wbi_signature already inserts wts into `params`
    // (src-tauri/src/utils/wbi.rs) and this query is built from `params`,
    // so pushing wts again would send the pair twice.
    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));

    // Why the retry loop: the playurl CDN host rotates per request between
    // *.bilivideo.com and upos-*.akamaized.net mirrors. The Akamai mirrors
    // advertise HTTP/3 (Alt-Svc: h3) and WKWebView upgrades the <video>
    // media fetch to QUIC, which times out from overseas networks and
    // aborts playback with MEDIA_ERR_SRC_NOT_SUPPORTED (measured 2026-10:
    // 12/12 akamaized URLs dead vs 15/15 bilivideo URLs playable, same
    // bytes over TCP). Re-request until a non-Akamai host is assigned; if
    // the pool stays Akamai-only for this video, return the last URL
    // rather than failing the preview outright.
    let mut attempts_left = PREVIEW_PLAYURL_MAX_ATTEMPTS;
    loop {
        let body: XPlayerApiResponse = api
            .get_q("/x/player/wbi/playurl", &query)
            .await?
            .json()
            .await
            .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

        if let Err(e) = validate_api_response(body.code, body.data.as_ref()) {
            // Same rationale as the fetch_wbi_view log: keep Bilibili's
            // code+message for diagnosis; the returned ERR::* code alone
            // cannot tell why the playurl was refused.
            log::warn!(
                "[BE] get_preview_play_url: playurl API rejected bvid={bvid}, code={}, message=\"{}\"",
                body.code,
                body.message
            );
            return Err(e);
        }

        let url = body
            .data
            .and_then(|d| d.durl)
            .and_then(|segments| segments.into_iter().next().map(|s| s.url))
            .ok_or_else(|| "ERR::NO_STREAM".to_string())?;
        // Why: durl URLs occasionally come back http://, and the preview
        // <video> runs on the tauri:// origin where each webview's
        // mixed-content handling is unverified — upgrade to https (same CDN
        // path serves both; cf. the https: prefix assumed for
        // protocol-relative subtitle URLs in download_subtitle).
        let url = url
            .strip_prefix("http://")
            .map(|rest| format!("https://{rest}"))
            .unwrap_or(url);

        attempts_left -= 1;
        if !is_akamai_mirror(&url) || attempts_left == 0 {
            log::info!("[BE] get_preview_play_url: resolved MP4 preview for bvid={bvid}");
            return Ok(url);
        }
        log::info!(
            "[BE] get_preview_play_url: akamai mirror assigned (WKWebView h3 playback risk), re-requesting, attempts_left={attempts_left}"
        );
    }
}

/// Playurl requests per preview resolve: enough re-rolls for the rotating
/// CDN pool to hand out a non-Akamai host, bounded to keep worst-case
/// latency at two extra API calls (see the retry loop in
/// [`get_preview_play_url_with`]).
const PREVIEW_PLAYURL_MAX_ATTEMPTS: u8 = 3;

/// True when the URL points at an Akamai CDN mirror (`*.akamaized.net`)
/// — the host family whose HTTP/3 advertisement breaks WKWebView media
/// playback (see [`get_preview_play_url_with`]).
fn is_akamai_mirror(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .is_some_and(|u| u.host_str().is_some_and(|h| h.ends_with(".akamaized.net")))
}

/// Timeout (seconds) for a single subtitle download request.
///
/// Subtitle payloads are small, but Bilibili's CDN occasionally stalls and
/// holds the connection open. Without a cap the request hangs indefinitely,
/// which surfaces to the user as a frozen download. The retry layer
/// (`download_subtitle_with_retry`) still handles transient failures.
const SUBTITLE_DOWNLOAD_TIMEOUT_SECS: u64 = 30;

/// Downloads a subtitle and saves it in SRT format.
///
/// Fetches BCC format JSON subtitle from Bilibili, converts to SRT format,
/// and saves to the specified path.
///
/// # Processing Flow
///
/// 1. Add "https:" prefix if URL starts with "//"
/// 2. Download BCC format JSON via HTTP request
/// 3. Parse JSON and convert to `BccSubtitle` struct
/// 4. Convert BCC format to SRT format
/// 5. Write to file
///
/// # Arguments
///
/// * `client` - HTTP client for requests
/// * `subtitle_url` - BCC subtitle JSON URL (may start with "//")
/// * `output_path` - Path to save the SRT file
/// * `max_duration_secs` - Optional video duration cap (seconds). Cues whose
///   `to` exceeds this are clamped during SRT conversion (see [`bcc_to_srt`]).
///
/// # Errors
///
/// Returns errors in the following cases:
/// - URL parse failure (malformed subtitle URL)
/// - Download failure
/// - Non-success HTTP response
/// - JSON parse failure
/// - File write failure
pub async fn download_subtitle(
    client: &Client,
    subtitle_url: &str,
    output_path: &std::path::Path,
    max_duration_secs: Option<f64>,
) -> Result<(), String> {
    let url = if subtitle_url.starts_with("//") {
        format!("https:{}", subtitle_url)
    } else {
        subtitle_url.to_string()
    };

    // Pre-parse with the url crate so a malformed subtitle URL fails here
    // with a precise error (raw URL + parser reason) instead of an opaque
    // reqwest "builder error" at send() time. Passing the parsed `Url`
    // also skips reqwest's own equivalent parse step.
    let parsed_url = url::Url::parse(&url).map_err(|e| {
        log::warn!(
            "[BE] download_subtitle: URL parse failed for '{}': {}",
            url,
            e
        );
        format!("Failed to parse subtitle URL '{}': {}", url, e)
    })?;

    let response = client
        .get(parsed_url)
        .timeout(Duration::from_secs(SUBTITLE_DOWNLOAD_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Failed to download subtitle '{}': {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error {} for '{}'", response.status(), url));
    }

    let bcc: crate::models::bilibili_api::BccSubtitle = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse subtitle JSON: {}", e))?;

    let srt_content = crate::utils::subtitle::bcc_to_srt(&bcc, max_duration_secs);

    tokio::fs::write(output_path, srt_content)
        .await
        .map_err(|e| format!("Failed to write subtitle file: {}", e))?;

    Ok(())
}

/// Downloads a subtitle with exponential backoff retry.
///
/// Retries up to [`MAX_RETRIES`] times when Bilibili's CDN returns stale
/// cached responses. The delay increases exponentially: 2s, 4s, 8s, 16s, 32s.
/// On each failed attempt, the output file is deleted to avoid leaving
/// partial files before proceeding to the next attempt.
///
/// # Arguments
///
/// * `client` - HTTP client used for the request
/// * `subtitle_url` - BCC subtitle JSON URL (may start with `//`)
/// * `output_path` - Output path for the converted SRT file
/// * `max_duration_secs` - Optional video duration cap forwarded to
///   [`download_subtitle`] for SRT clamping.
///
/// # Returns
///
/// Returns `Ok(())` if the download and SRT conversion succeed.
///
/// # Errors
///
/// Returns `Err(String)` with the last error message if all retry attempts
/// fail. Maximum retry count is [`MAX_RETRIES`] (default: 3).
async fn download_subtitle_with_retry(
    client: &Client,
    subtitle_url: &str,
    output_path: &std::path::Path,
    max_duration_secs: Option<f64>,
) -> Result<(), String> {
    const MAX_RETRIES: usize = 3;
    const BASE_DELAY_SECS: u64 = 2;

    for attempt in 0..MAX_RETRIES {
        match download_subtitle(client, subtitle_url, output_path, max_duration_secs).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                let _ = tokio::fs::remove_file(output_path).await;
                if attempt + 1 < MAX_RETRIES {
                    let delay = BASE_DELAY_SECS * 2u64.pow(attempt as u32);
                    log::warn!(
                        "[BE] download_subtitle_with_retry: attempt \
                         {}/{} failed for {}: {}. Retrying in {}s",
                        attempt + 1,
                        MAX_RETRIES,
                        output_path.display(),
                        e,
                        delay,
                    );
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                } else {
                    log::error!(
                        "[BE] download_subtitle_with_retry: all {} \
                         attempts exhausted for {}: {}",
                        MAX_RETRIES,
                        output_path.display(),
                        e,
                    );
                }
            }
        }
    }

    Err(format!(
        "Failed after {} retries for {}",
        MAX_RETRIES,
        output_path.display(),
    ))
}

/// Prepares subtitle merge mode based on user subtitle options.
///
/// Downloads selected subtitles and returns the appropriate merge mode for
/// ffmpeg. Converts BCC JSON subtitles to SRT format and saves them as
/// temporary files.
///
/// # Retry Strategy
///
/// Subtitle downloads execute up to 3 outer-loop attempts:
/// 1. Download each subtitle in parallel using current URLs (each with
///    3 exponential-backoff retries via [`download_subtitle_with_retry`])
/// 2. If any subtitles fail, re-fetch fresh URLs from the API
/// 3. Re-download only the failed subtitles using the new URLs
///
/// When the same URL fails repeatedly due to stale CDN cache data,
/// re-fetching from the API provides URLs from a different CDN node,
/// improving the success rate.
///
/// # Arguments
///
/// * `subtitle_opts` - User subtitle selection (mode and language codes)
/// * `cookies` - Cookie entries for authentication
/// * `bvid` - Bilibili video ID
/// * `cid` - Content ID
/// * `download_id` - Unique identifier used for temporary file names
/// * `lib_path` - Output directory for temporary subtitle files
/// * `duration_secs` - Optional video duration (seconds) used to clamp
///   out-of-range subtitle timestamps during SRT conversion.
///
/// # Returns
///
/// Returns a `(MergeMode, language_labels, failed_labels)` tuple:
/// - `MergeMode::None` - Subtitles disabled, none selected, or no matching subtitles found
/// - `MergeMode::SoftSub` - Soft subtitle mode (supports multiple languages)
/// - `MergeMode::HardSub` - Hard subtitle mode (burned-in, single language only)
/// - `language_labels` - Display names (`lan_doc`) of successfully downloaded subtitles
/// - `failed_labels` - Display names of subtitles that failed all 3 outer attempts
///
/// # Errors
///
/// Client construction happens in `download_video_impl` before this is
/// called, so no orphan "subtitle" emit is possible.
#[allow(clippy::too_many_arguments)]
async fn prepare_subtitle_mode<R: tauri::Runtime>(
    app: &AppHandle<R>,
    api: &BiliApi,
    subtitle_opts: &Option<SubtitleOptions>,
    bvid: &str,
    cid: i64,
    download_id: &str,
    lib_path: &Path,
    duration_secs: Option<f64>,
) -> Result<(crate::handlers::ffmpeg::MergeMode, Vec<String>, Vec<String>), String> {
    use crate::handlers::ffmpeg::{MergeMode, SubtitleMergeOptions};
    use crate::utils::subtitle::lan_to_iso639;

    let sub_opts = match subtitle_opts {
        Some(opts) if opts.mode != "off" && !opts.selected_lans.is_empty() => opts,
        _ => return Ok((MergeMode::None, vec![], vec![])),
    };

    // Emit a "subtitle" progress stage so the frontend can surface that the
    // subtitle download is running. Without this, the UI stays frozen at
    // audio/video 100% for the whole fetch + retry loop and looks hung.
    // Why a single emit with no periodic updates: subtitle payloads are small
    // and fetched in parallel per language, so there is no meaningful
    // byte-level progress to stream — the frontend renders this as an
    // indeterminate "downloading..." state.
    // Why this placement: the caller constructs the transport before
    // spawning this step, so any construction failure returns before
    // emitting and no orphan "subtitle" entry is left in the
    // frontend's progress slice bound to this download_id.
    let _ = app.emit(
        "progress",
        crate::emits::Progress {
            stage: Some("subtitle".to_string()),
            download_id: download_id.to_string(),
            ..Default::default()
        },
    );

    // Initial subtitles from frontend or API
    let initial_subs: Vec<SubtitleDto> = if !sub_opts.subtitles.is_empty() {
        log::info!(
            "[BE] prepare_subtitle_mode: using {} subtitles from frontend",
            sub_opts.subtitles.len()
        );
        sub_opts
            .subtitles
            .iter()
            .map(|s| SubtitleDto {
                lan: s.lan.clone(),
                lan_doc: s.lan_doc.clone(),
                subtitle_url: s.subtitle_url.clone(),
                is_ai: s.is_ai,
                ai_type: None,
            })
            .collect()
    } else {
        let subs = fetch_subtitles(api, bvid, cid).await;
        log::info!(
            "[BE] prepare_subtitle_mode: fetched {} subtitles from API",
            subs.len()
        );
        subs
    };

    let mut subtitle_files: Vec<SubtitleMergeOptions> = Vec::new();
    let mut language_labels: Vec<String> = Vec::new();
    let mut remaining_lans: Vec<String> = sub_opts.selected_lans.clone();

    const MAX_OUTER_ATTEMPTS: usize = 3;

    for attempt in 0..MAX_OUTER_ATTEMPTS {
        if remaining_lans.is_empty() {
            break;
        }

        let subs_for_attempt: Vec<SubtitleDto> = if attempt == 0 {
            initial_subs
                .iter()
                .filter(|s| remaining_lans.contains(&s.lan))
                .cloned()
                .collect()
        } else {
            log::warn!(
                "[BE] prepare_subtitle_mode: attempt {}/{}: \
                 re-fetching URLs for {} failed subtitle(s)",
                attempt + 1,
                MAX_OUTER_ATTEMPTS,
                remaining_lans.len(),
            );
            let fresh = fetch_subtitles(api, bvid, cid).await;
            fresh
                .into_iter()
                .filter(|s| remaining_lans.contains(&s.lan))
                .collect()
        };

        if subs_for_attempt.is_empty() {
            log::warn!(
                "[BE] prepare_subtitle_mode: no subtitles found \
                 for remaining languages: {:?}",
                remaining_lans
            );
            break;
        }

        let futures: Vec<_> = subs_for_attempt
            .into_iter()
            .map(|sub| {
                let srt_path = lib_path.join(format!("temp_sub_{download_id}_{}.srt", sub.lan));
                let client = api.http.clone();
                async move {
                    let result = download_subtitle_with_retry(
                        &client,
                        &sub.subtitle_url,
                        &srt_path,
                        duration_secs,
                    )
                    .await;
                    (sub.lan, sub.lan_doc, srt_path, result)
                }
            })
            .collect();

        let results = futures::future::join_all(futures).await;

        let mut failed_lans = Vec::new();
        for (lan, lan_doc, srt_path, result) in results {
            match result {
                Ok(()) => {
                    subtitle_files.push(SubtitleMergeOptions {
                        path: srt_path,
                        language: lan_to_iso639(&lan).to_string(),
                        title: lan_doc.clone(),
                    });
                    language_labels.push(lan_doc);
                }
                Err(e) => {
                    log::warn!(
                        "[BE] prepare_subtitle_mode: failed to \
                         download subtitle {}: {}",
                        lan,
                        e
                    );
                    failed_lans.push(lan);
                }
            }
        }

        remaining_lans = failed_lans;
        if remaining_lans.is_empty() {
            break;
        }
    }

    if subtitle_files.is_empty() {
        log::warn!("[BE] prepare_subtitle_mode: all subtitle downloads failed");
    }

    // Resolve display names for languages that failed all outer attempts
    let failed_labels: Vec<String> = remaining_lans
        .iter()
        .filter_map(|lan| {
            initial_subs
                .iter()
                .find(|s| s.lan == *lan)
                .map(|s| s.lan_doc.clone())
        })
        .collect();

    if !failed_labels.is_empty() {
        log::warn!(
            "[BE] prepare_subtitle_mode: {} subtitle(s) failed: {:?}",
            failed_labels.len(),
            failed_labels
        );
    }

    if subtitle_files.is_empty() {
        return Ok((MergeMode::None, vec![], failed_labels));
    }

    let mode = match sub_opts.mode.as_str() {
        "hard" => subtitle_files
            .into_iter()
            .next()
            .map(MergeMode::HardSub)
            .unwrap_or(MergeMode::None),
        _ => MergeMode::SoftSub(subtitle_files),
    };
    Ok((mode, language_labels, failed_labels))
}

// ============================================================================
// Bangumi Handlers
// ============================================================================

/// Fetches bangumi (anime/series) episode metadata from Bilibili.
///
/// Retrieves comprehensive information for a bangumi episode including title,
/// all available episodes, quality options, and VIP/preview status.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache and settings
/// * `ep_id` - Bangumi episode ID (e.g., 3051843)
///
/// # Returns
///
/// Returns a `Video` struct containing:
/// - Episode title and metadata
/// - List of all episodes in the series
/// - Quality options (may be limited for non-VIP users)
/// - VIP and preview status flags
///
/// # Errors
///
/// Returns an error if:
/// - Episode is not found (`ERR::BANGUMI_NOT_FOUND`)
/// - Episode requires VIP membership (`ERR::BANGUMI_VIP_ONLY`)
/// - Episode is region restricted (`ERR::BANGUMI_REGION_RESTRICTED`)
/// - Episode is copyright restricted (`ERR::BANGUMI_COPYRIGHT_RESTRICTED`)
/// - Access is denied (`ERR::BANGUMI_ACCESS_DENIED`)
/// - API request fails (`ERR::API_ERROR`)
pub async fn fetch_bangumi_info(app: &AppHandle, ep_id: i64) -> Result<Video, String> {
    use crate::utils::sanitize::{apply_title_replacements, resolve_duplicate_titles};

    log::info!(
        "[BE] fetch_bangumi_info: requesting bangumi info for ep_id={}",
        ep_id
    );

    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let api = BiliApi::from_cookie_header(cookie_header)?;
    let body: BangumiSeasonApiResponse = api
        .get(&format!("/pgc/view/web/season?ep_id={}", ep_id))
        .await?
        .json()
        .await
        .map_err(|e| format!("Failed to parse bangumi response: {}", e))?;

    validate_bangumi_response(body.code, &body.message)?;

    let result = body
        .result
        .ok_or_else(|| "ERR::BANGUMI_NOT_FOUND".to_string())?;

    // Find the target episode and use its AID as BVID placeholder
    let target_ep = result
        .episodes
        .iter()
        .find(|ep| ep.id == ep_id)
        .ok_or_else(|| "ERR::BANGUMI_NOT_FOUND".to_string())?;

    // Note: We don't block VIP-only episodes (status=13) here because
    // VIP members can still access them. The playurl API will return
    // DASH data for VIP users, and ERR::BANGUMI_NO_DASH for non-VIP users.
    // Each VideoPart keeps its status field for UI reference.

    // Get settings for title replacement
    let settings = settings::get_settings(app).await.ok();
    let replacements = settings
        .as_ref()
        .and_then(|s| s.title_replacements.as_deref());
    let auto_rename = settings
        .as_ref()
        .and_then(|s| s.auto_rename_duplicates)
        .unwrap_or(true);
    let omit_duplicate = settings
        .as_ref()
        .and_then(|s| s.omit_duplicate_part_title)
        .unwrap_or(true);

    // Convert episodes to VideoParts
    let mut parts: Vec<VideoPart> = result
        .episodes
        .iter()
        .enumerate()
        .map(|(idx, ep)| {
            let original_part = if ep.long_title.is_empty() {
                ep.title.clone()
            } else {
                format!("{} {}", ep.title, ep.long_title).trim().to_string()
            };
            let sanitized_part = apply_title_replacements(&original_part, replacements);
            VideoPart {
                cid: ep.cid,
                page: (idx + 1) as i32,
                part: original_part,
                sanitized_part: Some(sanitized_part),
                default_title: String::new(),
                duration: ep.duration / 1000, // Convert ms to seconds
                thumbnail: Thumbnail {
                    url: ep.cover.clone(),
                },
                video_qualities: vec![],
                audio_qualities: vec![],
                subtitles: vec![],
                ep_id: Some(ep.id),
                status: Some(ep.status),
                aid: Some(ep.aid),
                is_preview: None, // Will be set when fetching qualities
            }
        })
        .collect();

    // Apply duplicate title resolution if enabled
    if auto_rename {
        let sanitized_titles: Vec<String> = parts
            .iter()
            .filter_map(|p| p.sanitized_part.as_ref())
            .cloned()
            .collect();
        let resolved_titles = resolve_duplicate_titles(&sanitized_titles);
        // Apply resolved titles back to sanitized_part
        let mut resolved_iter = resolved_titles.into_iter();
        for part in parts.iter_mut() {
            if part.sanitized_part.is_some() {
                part.sanitized_part = resolved_iter.next();
            }
        }
    }

    // Apply title replacement to main title
    let sanitized_title = apply_title_replacements(&result.title, replacements);

    fill_default_part_titles(&mut parts, &sanitized_title, omit_duplicate);

    Ok(Video {
        title: sanitized_title,
        bvid: format!("av{}", target_ep.aid), // Use AID as identifier
        parts,
        is_limited_quality,
        content_type: "bangumi".to_string(),
        ep_id: Some(ep_id),
        season_title: Some(result.title),
    })
}

/// Fetches bangumi player result for quality selection.
///
/// Returns raw player result containing either DASH or durl format.
/// Used to determine download format for bangumi content.
///
/// # Arguments
///
/// * `cookies` - Cookie entries for authentication
/// * `ep_id` - Bangumi episode ID
/// * `cid` - Content ID
///
/// # Returns
///
/// Returns raw player result containing DASH or durl stream data.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Network request failure
/// - Non-success HTTP status
/// - API errors (`ERR::BANGUMI_NOT_FOUND`, `ERR::BANGUMI_ACCESS_DENIED`, etc.)
/// - Neither DASH nor durl available (`ERR::BANGUMI_NO_DASH`)
async fn fetch_bangumi_player_result(
    api: &BiliApi,
    ep_id: i64,
    cid: i64,
) -> Result<BangumiPlayerResult, String> {
    let response = api
        .get(&format!(
            "/pgc/player/web/playurl?ep_id={}&cid={}&qn={}&fnval={}&fnver=0&fourk=1",
            ep_id, cid, PLAYURL_QN, PLAYURL_FNVAL
        ))
        .await?;

    let body: BangumiPlayerApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse bangumi playurl response: {}", e))?;

    validate_bangumi_response(body.code, &body.message)?;

    let result = body
        .result
        .ok_or_else(|| "ERR::API_ERROR No result field".to_string())?;

    let has_dash = result.dash.is_some();
    let has_durl = result.durls.as_ref().is_some_and(|d| !d.is_empty());

    if !has_dash && !has_durl {
        return Err("ERR::BANGUMI_NO_DASH".into());
    }

    Ok(result)
}

/// Converts a [`BangumiPlayerResult`] into the [`XPlayerApiResponse`] shape
/// used by the DASH download flow.
///
/// Pure transformation with no HTTP, so it is directly unit-testable and is
/// shared by both the initial fetch in [`download_video`] (see issue #485) and
/// the refetch path in [`fetch_bangumi_details_for_download`]. Reusing the
/// already-fetched result on the initial bangumi DASH path eliminates the
/// duplicate playurl request.
///
/// # Errors
///
/// Returns `ERR::BANGUMI_DURL_NOT_SUPPORTED` when `result.dash` is `None`.
/// Callers must route durl-format results to `download_bangumi_durl` before
/// reaching this function.
fn bangumi_player_result_to_xplayer(
    result: BangumiPlayerResult,
) -> Result<XPlayerApiResponse, String> {
    match result.dash {
        Some(dash) => Ok(XPlayerApiResponse {
            code: 0,
            message: "success".to_string(),
            data: Some(XPlayerApiResponseData {
                dash: Some(dash),
                durl: None,
                support_formats: None,
                quality: None,
            }),
        }),
        None => Err("ERR::BANGUMI_DURL_NOT_SUPPORTED".into()),
    }
}

/// Fetches bangumi stream URLs for download (DASH format only).
///
/// Returns `XPlayerApiResponse` for compatibility with existing download flow.
/// This function only supports DASH format. For durl format (MP4),
/// the `download_video` function handles it separately.
///
/// # Arguments
///
/// * `cookies` - Cookie entries for authentication
/// * `ep_id` - Bangumi episode ID
/// * `cid` - Content ID
///
/// # Returns
///
/// Returns `XPlayerApiResponse` containing DASH data.
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Failed to fetch player result
/// - Only durl format available (`ERR::BANGUMI_DURL_NOT_SUPPORTED`)
async fn fetch_bangumi_details_for_download(
    api: &BiliApi,
    ep_id: i64,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    let result = fetch_bangumi_player_result(api, ep_id, cid).await?;
    bangumi_player_result_to_xplayer(result)
}

/// Fresh signed stream URLs obtained by re-calling the playurl API on retry.
///
/// Bilibili CDN URLs carry a signature that expires after 120 minutes. When a
/// segment download fails on retry (attempt > 1), the originally captured URL
/// may have expired. This struct holds the re-fetched URLs so the retry uses a
/// fresh signature instead of replaying the same stale URL.
struct FreshDashUrls {
    video_url: String,
    video_backup_urls: Option<Vec<String>>,
    audio_url: String,
    audio_backup_urls: Option<Vec<String>>,
}

/// Refetch context passed into `download_audio_with_fallback` so the primary
/// audio closure can re-fetch fresh signed URLs on retry (attempt > 1).
///
/// `audio_quality` is the resolved quality id of the primary stream (None when
/// the user did not pick one and best-available was used). `video_quality` is
/// not needed for an audio-only refetch, so it is omitted; `refetch_dash_urls`
/// is called with -1 (best) for the video slot, whose result is discarded.
/// `api` carries the transport (client + origin + cookie) for refetches.
struct AudioRefetchCtx {
    api: BiliApi,
    bvid: String,
    cid: i64,
    ep_id: Option<i64>,
    audio_quality: Option<i32>,
}

/// Re-fetches fresh signed DASH stream URLs from the playurl API.
///
/// Dispatches by `ep_id.is_some()`: bangumi uses
/// `fetch_bangumi_details_for_download`, regular videos use
/// `fetch_video_details`. Both normalize to `XPlayerApiResponse` with a `dash`
/// field, so the same selection logic applies. The caller resolves the same
/// quality pair it originally selected (requested video quality + resolved
/// audio quality). On error, callers fall back to the stale captured URL
/// (see the retry closures) rather than aborting the retry loop.
async fn refetch_dash_urls(
    api: &BiliApi,
    codec_priority: crate::utils::codec::VideoCodecPriority,
    bvid: &str,
    cid: i64,
    ep_id: Option<i64>,
    video_quality: i32,
    audio_quality: Option<i32>,
) -> Result<FreshDashUrls, String> {
    log::info!(
        "[BE] refetch_dash_urls: refreshing signed DASH URLs (ep_id={:?}, cid={}, vq={}, aq={:?})",
        ep_id,
        cid,
        video_quality,
        audio_quality
    );
    let details = if let Some(ep) = ep_id {
        fetch_bangumi_details_for_download(api, ep, cid).await?
    } else {
        fetch_video_details(api, bvid, cid).await?
    };
    let data = details
        .data
        .ok_or_else(|| "refetch_dash_urls: playurl response has no data".to_string())?;
    let dash = data
        .dash
        .ok_or_else(|| "refetch_dash_urls: playurl response has no dash".to_string())?;

    // Reuse the same codec-aware stream selection as the initial download so
    // a retry picks the same codec (keeps the merged output consistent).
    // `video_quality` is the resolved quality, so scoping to it mirrors the
    // initial download's per-quality codec selection.
    let (streams_for_selection, _) =
        select_streams_by_codec_priority_with(codec_priority, &dash.video, Some(video_quality));
    let (video_url, video_backup_urls, _) =
        select_stream_url(&streams_for_selection, Some(video_quality))?;
    // Silent sources carry no audio list — selecting would fail the whole
    // refetch and cost the video side its fresh URL (issue #446). The audio
    // fields are simply unused by the silent download path.
    let selectable_audio = dash.selectable_audio();
    let (audio_url, audio_backup_urls) = if selectable_audio.is_empty() {
        (String::new(), None)
    } else {
        let resolved_audio_quality = audio_quality
            .unwrap_or_else(|| best_audio_quality_id(&selectable_audio).unwrap_or(30280));
        let (url, backups, _) = select_stream_url(&selectable_audio, Some(resolved_audio_quality))?;
        (url, backups)
    };
    Ok(FreshDashUrls {
        video_url,
        video_backup_urls,
        audio_url,
        audio_backup_urls,
    })
}

/// Re-fetches a fresh signed durl URL (MP4 / single-stream format) from the playurl API.
///
/// durl takes two structurally different shapes that must be handled separately:
/// - Regular videos: `data.durl` (flat list of `DurlSegment`).
/// - Bangumi: `result.durls` (per-quality nested entries; `fetch_bangumi_details_for_download`
///   rejects durl, so we read `fetch_bangumi_player_result` directly here).
///
/// Re-selects the first segment (durl format has a single combined stream).
async fn refetch_durl_url(
    api: &BiliApi,
    bvid: &str,
    cid: i64,
    ep_id: Option<i64>,
) -> Result<(String, Option<Vec<String>>), String> {
    log::info!(
        "[BE] refetch_durl_url: refreshing signed durl URL (ep_id={:?}, cid={})",
        ep_id,
        cid
    );
    if let Some(ep) = ep_id {
        let result = fetch_bangumi_player_result(api, ep, cid).await?;
        let durls = result
            .durls
            .as_ref()
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "refetch_durl_url: bangumi has no durls".to_string())?;
        let entry = durls
            .first()
            .ok_or_else(|| "refetch_durl_url: empty durls".to_string())?;
        let seg = entry
            .durl
            .first()
            .ok_or_else(|| "refetch_durl_url: empty durl".to_string())?;
        let backup = seg
            .backup_url
            .as_ref()
            .map(|u| u.iter().map(|s| s.to_string()).collect());
        Ok((seg.url.clone(), backup))
    } else {
        // fnval=0 keeps the response on the durl format even for
        // audio-stripped DASH videos (issue #446), so a fresh muxed URL is
        // always available here.
        let details = fetch_video_details_with_fnval(api, bvid, cid, 0).await?;
        let data = details
            .data
            .ok_or_else(|| "refetch_durl_url: no data".to_string())?;
        let durl = data
            .durl
            .as_ref()
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "refetch_durl_url: no durl".to_string())?;
        let seg = durl
            .first()
            .ok_or_else(|| "refetch_durl_url: empty durl".to_string())?;
        let backup = seg
            .backup_url
            .as_ref()
            .map(|u| u.iter().map(|s| s.to_string()).collect());
        Ok((seg.url.clone(), backup))
    }
}

/// Fetches available video and audio qualities for a bangumi episode part.
///
/// Used for lazy-loading quality options when a specific part is rendered
/// in the UI (virtual scrolling optimization).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `ep_id` - Bangumi episode ID
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns a tuple containing:
/// - `video_qualities`: Vector of available video quality options
/// - `audio_qualities`: Vector of available audio quality options (empty for durl format)
/// - `is_preview`: Optional boolean indicating if this is a preview-only episode
///
/// # Errors
///
/// Returns an error if:
/// - API request fails
/// - Response parsing fails
/// - No stream data is available
pub async fn fetch_bangumi_part_qualities(
    app: &AppHandle,
    ep_id: i64,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>, Option<bool>), String> {
    log::info!(
        "[BE] fetch_bangumi_part_qualities: requesting qualities for ep_id={}, cid={}",
        ep_id,
        cid
    );
    let cookies = read_cookie(app)?.unwrap_or_default();
    let api = BiliApi::from_cookies(&cookies)?;
    fetch_bangumi_part_qualities_with(&api, ep_id, cid).await
}

/// Transport-injectable core of [`fetch_bangumi_part_qualities`] (test seam).
async fn fetch_bangumi_part_qualities_with(
    api: &BiliApi,
    ep_id: i64,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>, Option<bool>), String> {
    let result = fetch_bangumi_player_result(api, ep_id, cid).await?;

    let is_preview = result.is_preview.map(|v| v == 1);

    // Try DASH format first
    if let Some(dash) = &result.dash {
        let selectable_audio = dash.selectable_audio();
        let video_qualities = convert_qualities(&dash.video, video_quality_rank);
        let audio_qualities = convert_qualities(&selectable_audio, audio_quality_rank);
        log::info!(
            "[BE] fetch_bangumi_part_qualities: received {} video qualities, {} audio qualities",
            video_qualities.len(),
            audio_qualities.len()
        );
        return Ok((video_qualities, audio_qualities, is_preview));
    }

    // Fall back to durl format (MP4 direct URL)
    // In durl format, audio is embedded in the video file, so no separate audio qualities
    if let Some(durls) = &result.durls {
        let video_qualities: Vec<Quality> = durls
            .iter()
            .filter(|entry| !entry.durl.is_empty())
            .map(|entry| Quality {
                id: entry.quality,
                codecid: 7, // AVC for MP4 format
                quality: quality_to_string(&entry.quality),
            })
            .collect();

        // Return empty audio qualities for durl format (audio is embedded)
        return Ok((video_qualities, vec![], is_preview));
    }

    // Should not reach here as fetch_bangumi_player_result validates data presence
    Err("ERR::BANGUMI_NO_DASH".into())
}

// ============================================================================
// Short URL Expansion
// ============================================================================

/// Expands a b23.tv short URL to its full bilibili.com URL.
///
/// This function follows HTTP redirects to resolve the final URL.
/// Used to convert short URLs like `https://b23.tv/BV1xx411c7XD` to
/// full URLs like `https://www.bilibili.com/video/BV1xx411c7XD`.
///
/// # Arguments
///
/// * `url` - The b23.tv short URL to expand
///
/// # Returns
///
/// Returns the final URL after following all redirects.
///
/// # Errors
///
/// Returns `ERR::SHORT_URL_EXPAND` if:
/// - The HTTP request fails
/// - The redirect limit (5) is exceeded
/// - Network issues occur
///
/// # Example
///
/// Why: expand_short_url follows a live b23.tv redirect over the network; doctests
/// run in CI (rust-test job) and must not hit external services
/// ```ignore
/// let full_url = expand_short_url("https://b23.tv/abc123".to_string()).await?;
/// assert!(full_url.starts_with("https://www.bilibili.com/video/"));
/// ```
pub async fn expand_short_url(url: String) -> Result<String, String> {
    // Build a client with redirect policy for short URL expansion
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("ERR::SHORT_URL_EXPAND: failed to build client: {}", e))?;

    expand_short_url_with(client, url).await
}

/// Redirect-following expansion over an injected client so wiremock tests
/// can exercise the redirect chain against a local server.
async fn expand_short_url_with(client: Client, url: String) -> Result<String, String> {
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("ERR::SHORT_URL_EXPAND: {}", e))?;

    Ok(response.url().to_string())
}
