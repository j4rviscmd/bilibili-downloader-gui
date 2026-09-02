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
    /// Resolved audio quality ID (null for durl format)
    pub audio_quality: Option<i32>,
    /// Whether audio quality was fallen back from user selection
    pub audio_quality_fallback: bool,
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

use crate::constants::{API_BASE, REFERER};
use crate::handlers::cookie::read_cookie;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    BangumiPlayerApiResponse, BangumiPlayerResult, BangumiSeasonApiResponse, PlayerV2ApiResponse,
    UserApiResponse, WatchHistoryApiResponse, WebInterfaceApiResponse, WebInterfaceApiResponseData,
    XPlayerApiResponse, XPlayerApiResponseData, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{
    DownloadRetrying, Quality, SubtitleDto, Thumbnail, UserData, Video, VideoPart,
    WatchHistoryCursor, WatchHistoryEntry,
};
use crate::models::settings::Settings;
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::header;
use reqwest::Client;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
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
pub(crate) struct BiliApi {
    http: Client,
    /// API origin, e.g. "https://api.bilibili.com" (wiremock URL in tests)
    base: String,
    /// Pre-built Cookie header value; empty when logged out
    cookie_header: String,
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
        Ok(Self::new(build_client()?, API_BASE, cookie_header))
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
async fn download_bangumi_durl(
    app: &AppHandle,
    options: &DownloadOptions,
    output_path: &Path,
    cookie_header: &str,
    cookies: &[CookieEntry],
    player_result: BangumiPlayerResult,
    host_health: Arc<crate::utils::cdn_selector::HostHealth>,
) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // download_video already registered the cancellation token. Do NOT
    // re-register here (it would overwrite the existing token and lose an
    // in-flight cancel). Just check the pre-cancel flag.
    if DOWNLOAD_CANCEL_REGISTRY
        .is_cancelled(&options.download_id)
        .await
    {
        DOWNLOAD_CANCEL_REGISTRY
            .clear_cancelled(&options.download_id)
            .await;
        DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;
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
            is_preview,
        },
    )
    .ok();

    // Get segment concurrency from settings
    let settings = settings::get_settings(app).await.ok();
    let segment_concurrency = Settings::resolve_segment_concurrency(&settings);

    // Capacity check
    if let Some(vs) = head_content_length(video_url, Some(cookie_header)).await {
        let total_needed = vs + (5 * 1024 * 1024); // 5MB buffer
        ensure_free_space(output_path, total_needed)?;
    }

    // Refetch inputs for attempt > 1 (bilibili signed URLs expire after 120 min).
    let bd_refetch_cookies = cookies.to_vec();
    let bd_refetch_bvid = options.bvid.clone();
    let bd_cid = options.cid;
    let bd_ep_id = options.ep_id;
    let bd_video_url = video_url.clone();
    let bd_backup_urls = backup_urls.clone();
    let bd_output_path = output_path.to_path_buf();
    let bd_cookie_header = cookie_header.to_string();
    let bd_download_id = options.download_id.clone();
    let bd_host_health = host_health.clone();
    // Download directly. Capture the result so we always remove the token
    // (success or error) to avoid a registry leak on the early-return path.
    let result = retry_download(
        app,
        &options.download_id,
        Some("video"),
        move |attempt: u8| {
            // Re-clone per call: async move consumes captured values, but
            // FnMut may invoke the closure up to MAX_ATTEMPTS times.
            let cookies = bd_refetch_cookies.clone();
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
                    match refetch_durl_url(&cookies, &bvid, bd_cid, bd_ep_id).await {
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

    // Always clean up the registry (success or error): remove the token AND
    // clear the pre-cancel flag. Mirrors the regular durl and DASH cleanup
    // paths (remove + clear_cancelled). clear_cancelled matters here because
    // cancel() records the id in cancelled_ids for the get_token-None
    // fallback; without this, a cancelled bangumi-durl id would linger and
    // could falsely trip download_video's start-up is_cancelled check on id
    // reuse, and accumulate over long-running sessions.
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;
    DOWNLOAD_CANCEL_REGISTRY
        .clear_cancelled(&options.download_id)
        .await;

    match result {
        Ok(()) => {
            let output_path_str = output_path.to_string_lossy().to_string();
            let actual_file_size = tokio::fs::metadata(output_path).await.ok().map(|m| m.len());
            // Save to history asynchronously (success only)
            spawn_save_to_history(app, options, actual_file_size);
            Ok(output_path_str)
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
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    log::info!(
        "[BE] download_video: starting download id={}, bvid={}, cid={}",
        options.download_id,
        options.bvid,
        options.cid
    );

    // Get segment concurrency from settings
    let settings = settings::get_settings(app).await.ok();
    let segment_concurrency = Settings::resolve_segment_concurrency(&settings);

    // If this part was cancelled (via cancel_all_downloads) before
    // download_video started, reject immediately so it never runs.
    if DOWNLOAD_CANCEL_REGISTRY
        .is_cancelled(&options.download_id)
        .await
    {
        DOWNLOAD_CANCEL_REGISTRY
            .clear_cancelled(&options.download_id)
            .await;
        return Err("ERR::CANCELLED".to_string());
    }

    // Register cancellation token for this download
    let cancel_token = DOWNLOAD_CANCEL_REGISTRY
        .register(&options.download_id)
        .await;

    // Per-download CDN host health, shared by the video stream, audio
    // stream(s), every retry attempt, and their segment tasks. Dropping the
    // last Arc when this download ends clears the state (issue #527).
    let host_health = Arc::new(crate::utils::cdn_selector::HostHealth::new());

    // 1. Determine output file path + reserve it (multi-process safe,
    //    issue #560). All bytes are written to the reserved staging name
    //    (`{stem}.part.{ext}`) and renamed to the final name on success;
    //    `OutputReservation`'s Drop removes the staging file on every early
    //    return below.
    let reservation = reserve_output_path(&build_output_path(app, &options.filename).await?)?;

    // TODO(#561): every `?` below returns before the function-final
    // DOWNLOAD_CANCEL_REGISTRY cleanup, leaking the cancel token registered
    // above. The reservation's Drop covers the staging file, but the token
    // needs its own guard — tracked separately.
    // 2. Get cookies (WBI signing enables non-logged-in usage)
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);

    // 3. For bangumi, fetch player result to check is_preview and durl format.
    //    The DASH result is reused in step 4 to avoid a duplicate playurl request.
    //    CAUTION: the durl branch moves `player_result` into `download_bangumi_durl`
    //    and returns early, so only the DASH path reaches step 4. See issue #485.
    let (bangumi_preview_info, cached_bangumi_details) = if let Some(ep_id) = options.ep_id {
        let player_result = fetch_bangumi_player_result(&cookies, ep_id, options.cid).await?;
        let is_preview = player_result.is_preview.map(|v| v == 1);

        // durl format (direct MP4 URL): consume player_result and return early.
        if player_result.dash.is_none() {
            // Finalize: rename the completed staging file to its final name;
            // on error the reservation's Drop removes the staging file.
            return download_bangumi_durl(
                app,
                options,
                reservation.reserved_path(),
                &cookie_header,
                &cookies,
                player_result,
                host_health,
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
        fetch_video_details(&cookies, &options.bvid, options.cid).await?
    };

    let data = details.data.ok_or_else(|| {
        format!(
            "XPlayerApi error (code {}): {} - no data field",
            details.code, details.message
        )
    })?;

    // Regular video durl format (audio embedded in MP4). Wrapped in a block so
    // all early returns funnel through the cleanup below — this path otherwise
    // bypasses download_video's final cleanup (remove + clear_cancelled).
    if data.dash.is_none() {
        let result: Result<String, String> = async {
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
                    is_preview: None,
                },
            )
            .ok();

            if let Some(vs) = head_content_length(&video_url, Some(&cookie_header)).await {
                ensure_free_space(reservation.reserved_path(), vs + 5 * 1024 * 1024)?;
            }

            let d_refetch_cookies = cookies.clone();
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
                    let cookies = d_refetch_cookies.clone();
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
                            match refetch_durl_url(&cookies, &bvid, d_cid, d_ep_id).await {
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

            let output_path_str = reservation.reserved_path().to_string_lossy().to_string();
            let actual_file_size = tokio::fs::metadata(reservation.reserved_path())
                .await
                .ok()
                .map(|m| m.len());
            spawn_save_to_history(app, options, actual_file_size);
            Ok(output_path_str)
        }
        .await;

        // Finalize: rename the completed staging file to its final name; on
        // error the reservation's Drop removes the staging file.
        let result = result
            .and_then(|_| reservation.complete())
            .map(|p| p.to_string_lossy().into_owned());

        // Cleanup: remove token and clear the pre-cancel flag (this path
        // bypasses download_video's final cleanup).
        DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;
        DOWNLOAD_CANCEL_REGISTRY
            .clear_cancelled(&options.download_id)
            .await;

        return result;
    }

    let dash_data = data.dash.unwrap();

    // Seed the shared mirror pool from the whole DASH manifest (video +
    // audio streams, base + backup URLs) so the video pre-selection already
    // knows mirror hosts that only the audio streams carry (issue #527).
    let manifest_urls: Vec<String> = dash_data
        .video
        .iter()
        .chain(dash_data.audio.iter())
        .flat_map(|s| {
            let mut v = vec![s.base_url.clone()];
            v.extend(s.backup_urls.clone().unwrap_or_default());
            v
        })
        .collect();
    host_health.seed_mirrors_from_urls(&manifest_urls);

    // Diagnostic: record the audio stream landscape and any VIP-only
    // objects (dolby/flac) present in the manifest. Does not affect
    // selection; lets us confirm from reporter logs whether a VIP account's
    // manifest contained Hi-Res/Dolby entries (issue #467 investigation).
    log::info!(
        "[BE] download_video: dash audio landscape id={} audio_ids={:?} extra_keys={:?}",
        options.download_id,
        dash_data.audio.iter().map(|a| a.id).collect::<Vec<_>>(),
        dash_data.extra.keys().collect::<Vec<_>>(),
    );

    // Resolve codec priority and filter streams. Falls back to all streams
    // when the preferred codec is unavailable so the download never fails.
    let (streams_for_selection, codec_selection) =
        select_streams_by_codec_priority(app, &dash_data.video).await;

    // Fallback if selected quality is unavailable (first = highest quality)
    // None means best available → -1 won't match any real quality ID.
    let requested_quality = options.quality.unwrap_or(-1);

    let (video_url, video_backup_urls, raw_video_fallback) =
        select_stream_url(&streams_for_selection, requested_quality)?;
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
        .unwrap_or((requested_quality, CODECID_AVC));

    // True when the preferred codec was unavailable: either a lower-priority
    // codec was selected (fallback flag), or no priority codec existed at all
    // (None → fell back to all streams). The latter must also warn so users
    // notice when e.g. an H.264-only preference silently gets HEVC/AV1.
    let video_codec_fallback = codec_selection
        .as_ref()
        .map(|sel| sel.fallback)
        .unwrap_or(true);

    let audio_quality = options
        .audio_quality
        .unwrap_or(dash_data.audio.first().map(|a| a.id).unwrap_or(30280));
    let (audio_url, audio_backup_urls, raw_audio_fallback) =
        select_stream_url(&dash_data.audio, audio_quality)?;
    // Same logic: only warn when the user explicitly chose an audio quality.
    let audio_quality_fallback = options.audio_quality.is_some() && raw_audio_fallback;
    // Get the actual resolved audio quality ID
    let resolved_audio_quality = dash_data
        .audio
        .iter()
        .find(|a| a.base_url == audio_url)
        .map(|a| a.id);

    log::info!(
        "[BE] download_video: resolved audio quality id={:?} (requested {:?}) for id={}",
        resolved_audio_quality,
        options.audio_quality,
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
            is_preview: bangumi_preview_info,
        },
    )
    .ok();

    // 5. Pre-check disk space (skip if size cannot be determined)
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 5MB buffer
        ensure_free_space(reservation.reserved_path(), total_needed)?;
    }

    // 6. Generate temp file paths
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", options.download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", options.download_id));

    // Hold an exclusive flock on both temp files for the whole download
    // (issue #560): startup cleanup treats a temp file whose flock is free as
    // an orphan (owner crashed) and deletes it immediately regardless of age,
    // so a second app instance must never see an in-flight temp as garbage.
    // The lock lives on the inode the download writes to (created once by
    // preallocate/single-stream open, never deleted-and-recreated mid-flight),
    // and advisory locking never blocks our own writers.
    // Note: keep the named binding — `let _ = lock_temp_paths(...)` would drop
    // the locks immediately, and startup cleanup would then delete these
    // in-flight temps as orphans.
    let _temp_locks = lock_temp_paths(&[&temp_video_path, &temp_audio_path]);

    // Result to track success/failure for cleanup
    let result = async {
        // 7. Acquire semaphore + parallel download + merge
        // Semaphore is held until merge completes; concurrency is based on merge load
        let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

        let cookie = Some(cookie_header);

        // Download audio with fallback and video in parallel (cancel immediately if either fails)
        // Audio uses fallback to handle invalid media responses from VIP-specific CDN edges
        let audio_refetch_ctx = AudioRefetchCtx {
            cookies: cookies.clone(),
            bvid: options.bvid.clone(),
            cid: options.cid,
            ep_id: options.ep_id,
            audio_quality: resolved_audio_quality,
        };
        let audio_download = download_audio_with_fallback(
            app,
            &options.download_id,
            audio_url.clone(),
            audio_backup_urls.clone(),
            temp_audio_path.clone(),
            cookie.clone(),
            &dash_data.audio,
            &audio_refetch_ctx,
            host_health.clone(),
        );
        // Refetch inputs for attempt > 1 (bilibili signed URLs expire after
        // 120 min). Cloned here because the move closure must own them, while
        // `cookie` is shared with audio_download and `cookies` with subtitle prep.
        let v_refetch_cookies = cookies.clone();
        let v_refetch_bvid = options.bvid.clone();
        let v_cid = options.cid;
        let v_ep_id = options.ep_id;
        let v_quality = resolved_video_quality;
        let v_download_id = options.download_id.clone();
        let v_video_url = video_url.clone();
        let v_video_backups = video_backup_urls.clone();
        let v_temp_video_path = temp_video_path.clone();
        let v_cookie = cookie.clone();
        let video_download = retry_download(
            app,
            &options.download_id,
            Some("video"),
            move |attempt: u8| {
                // Re-clone per call: async move consumes captured values, but
                // FnMut may invoke the closure up to MAX_ATTEMPTS times.
                let cookies = v_refetch_cookies.clone();
                let bvid = v_refetch_bvid.clone();
                let video_url = v_video_url.clone();
                let video_backup_urls = v_video_backups.clone();
                let temp_video_path = v_temp_video_path.clone();
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
                            app, &cookies, &bvid, v_cid, v_ep_id, v_quality, None,
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

        tokio::try_join!(audio_download, video_download)?;

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
                &options.subtitle,
                &cookies,
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
        crate::handlers::ffmpeg::merge_avs(
            app,
            &temp_video_path,
            &temp_audio_path,
            reservation.reserved_path(),
            Some(options.download_id.clone()),
            Some((options.duration_seconds * 1000) as u64),
            subtitle_mode,
            Some(cancel_token.clone()),
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

        // Save to history (async failure does not affect download)
        spawn_save_to_history(app, options, actual_file_size);

        Ok(final_path.to_string_lossy().into_owned())
    }
    .await;

    // Cleanup: Remove cancellation token from registry and clear any
    // pre-cancel flag so cancelled_ids doesn't accumulate.
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;
    DOWNLOAD_CANCEL_REGISTRY
        .clear_cancelled(&options.download_id)
        .await;

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
    use super::*;

    /// Tests quality ID to human-readable string conversion.
    ///
    /// Verifies that known quality IDs produce expected display names
    /// and unknown IDs fall back to "Q{id}" format.
    #[test]
    fn test_quality_to_string() {
        assert_eq!(quality_to_string(&116), "4K");
        assert_eq!(quality_to_string(&112), "1080P60");
        assert_eq!(quality_to_string(&80), "1080P");
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
        let known_qualities = [116, 112, 80, 64, 32, 16];
        for q in known_qualities {
            let result = quality_to_string(&q);
            assert!(
                !result.is_empty(),
                "Quality {} should produce non-empty string",
                q
            );
        }
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
        let qualities = convert_qualities(&streams);
        let ids: Vec<i32> = qualities.iter().map(|q| q.id).collect();
        assert_eq!(ids, vec![80, 64], "qualities sorted best-first");
        assert_eq!(qualities[0].codecid, 12, "highest codecid kept for 80");
        assert_eq!(qualities[0].quality, "1080P");
        assert_eq!(qualities[1].quality, "720P");
    }

    // ---- select_stream_url ----

    #[test]
    fn select_stream_url_exact_match_marks_no_fallback() {
        let items = vec![stream(80, 7), stream(64, 7)];
        let (url, _backup, fell_back) = select_stream_url(&items, 64).unwrap();
        assert_eq!(url, "https://example.com/64.m4s");
        assert!(!fell_back);
    }

    #[test]
    fn select_stream_url_unknown_quality_falls_back_to_first() {
        let items = vec![stream(80, 7), stream(64, 7)];
        let (url, _, fell_back) = select_stream_url(&items, 127).unwrap();
        assert_eq!(url, "https://example.com/80.m4s");
        assert!(fell_back, "caller shows a quality-fallback warning");
    }

    #[test]
    fn select_stream_url_empty_list_errors() {
        assert_eq!(
            select_stream_url(&[], 80),
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
    }

    #[test]
    fn drop_without_complete_removes_staging_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abandoned.mp4");
        let reservation = reserve_output_path(&path).unwrap();
        std::fs::write(reservation.reserved_path(), b"partial").unwrap();
        drop(reservation);
        assert!(!reservation_exists(dir.path(), "abandoned.part.mp4"));
        assert!(!path.exists(), "final name must stay untouched on failure");
    }

    #[test]
    fn dead_reservation_is_reclaimed_on_next_reserve() {
        // Simulate a crashed process: a staging file exists but nobody holds
        // its flock. The next reserve for the same name must reclaim it
        // instead of jumping to " (1)".
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
    }

    // ---- ensure_free_space (fs, tempfile) ----

    #[test]
    fn ensure_free_space_accepts_small_requests() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out.mp4");
        // 1 byte against a real (temp) filesystem with space available
        assert!(ensure_free_space(&target, 1).is_ok());
    }

    // Why: the disk-space check is statvfs (unix-only); on Windows the
    // function unconditionally returns Ok(()) and this assertion cannot hold.
    #[cfg(target_family = "unix")]
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

        // Same transport shape fetch_video_title_by_build builds via
        // from_cookies; constructed manually so `base` targets the mock
        // server while the validator path stays under test.
        let api = BiliApi::new(Client::new(), server.uri(), "SESSDATA=stale");
        let body: WebInterfaceApiResponse = api
            .get("/x/web-interface/view?bvid=x")
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
        let video = web_interface_data_to_video(&data, "BV1x", None, false, true);
        assert_eq!(video.parts.len(), 1);
        assert_eq!(video.parts[0].cid, 7);
        assert_eq!(video.parts[0].part, "Main Title");
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("Main Title"));
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
        let video = web_interface_data_to_video(&data, "BV1x", None, false, false);
        assert_eq!(video.parts.len(), 2);
        assert_eq!(video.parts[0].part, "Part A");
        assert_eq!(video.parts[1].part, "T");
        assert_eq!(video.parts[1].thumbnail.url, "http://pic");
        assert_eq!(video.parts[1].duration, 30);
    }

    #[test]
    fn web_interface_data_to_video_resolves_duplicate_sanitized_names() {
        let pages = vec![page(1, 1, "same", 1), page(2, 2, "same", 1)];
        let data = view_data("T", "p", 0, Some(pages));
        let video = web_interface_data_to_video(&data, "BV1x", None, true, false);
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("same"));
        assert_eq!(video.parts[1].sanitized_part.as_deref(), Some("same (1)"));
    }

    #[test]
    fn web_interface_data_to_video_applies_title_replacements() {
        use crate::models::settings::TitleReplacement;
        let data = view_data("a:b", "p", 1, Some(vec![]));
        let rules = [TitleReplacement::new(":", "_", true)];
        let video = web_interface_data_to_video(&data, "BV1x", Some(&rules), false, false);
        assert_eq!(video.title, "a_b");
        assert_eq!(video.parts[0].sanitized_part.as_deref(), Some("a_b"));
    }
}

/// Spawns an async task to save download history.
///
/// Extracts relevant fields from `options` and spawns a background task
/// that calls [`save_to_history`]. Failures are logged but not propagated.
fn spawn_save_to_history(app: &AppHandle, options: &DownloadOptions, file_size: Option<u64>) {
    let app = app.clone();
    let bvid = options.bvid.clone();
    let filename = options.filename.clone();
    let quality = options.quality;
    let thumbnail_url = options.thumbnail_url.clone();
    let page = options.page;
    tokio::spawn(async move {
        if let Err(e) = save_to_history(
            &app,
            &bvid,
            quality,
            file_size,
            &filename,
            thumbnail_url,
            page,
        )
        .await
        {
            log::warn!(
                "[BE] download_video: failed to save to history for {}: {}",
                bvid,
                e
            );
        }
    });
}

/// Saves a history entry after download completion.
///
/// Creates a history record with video metadata, quality info, and file size.
/// The entry is persisted via `HistoryStore` and emitted as an event to notify
/// the frontend.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `bvid` - Bilibili video ID
/// * `quality` - Downloaded video quality ID
/// * `file_size` - Actual file size in bytes (optional)
/// * `filename` - Output filename used for title extraction
/// * `thumbnail_url` - Video thumbnail URL (fetched if not provided)
/// * `page` - Page number for multi-part videos (optional)
///
/// # Returns
///
/// Returns `Ok(())` on success, or an error if store operations fail.
async fn save_to_history(
    app: &AppHandle,
    bvid: &str,
    quality: Option<i32>,
    file_size: Option<u64>,
    filename: &str,
    thumbnail_url: Option<String>,
    page: Option<i32>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::models::history::HistoryEntry;
    use crate::store::HistoryStore;
    use chrono::Utc;
    use std::path::Path;

    let title = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string();

    let thumbnail_url = match thumbnail_url {
        Some(url) => Some(url),
        None => {
            let cookies = read_cookie(app)?.unwrap_or_default();
            fetch_video_info_for_history(bvid, &cookies)
                .await
                .and_then(|(_, url)| url)
        }
    };

    let page_suffix = page.map(|p| format!("?p={p}")).unwrap_or_default();

    let url = format!("https://www.bilibili.com/video/{bvid}{page_suffix}");

    let id = format!(
        "{bvid}_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let entry = HistoryEntry {
        id,
        title,
        bvid: Some(bvid.to_string()),
        url,
        downloaded_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        status: "completed".to_string(),
        file_size,
        quality: quality.as_ref().map(quality_to_string),
        thumbnail_url,
        version: "1.0".to_string(),
    };

    HistoryStore::new(app)?.add_entry(entry.clone())?;

    // Emit event to notify frontend of new history entry
    let _ = app.emit("history:entry_added", &entry);

    Ok(())
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
/// * `quality` - Bilibili quality ID (e.g., 116 for 4K, 80 for 1080P)
///
/// # Returns
///
/// Human-readable quality string.
fn quality_to_string(quality: &i32) -> String {
    match quality {
        116 => "4K".to_string(),
        112 => "1080P60".to_string(),
        80 => "1080P".to_string(),
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
async fn fetch_video_info_for_history(
    bvid: &str,
    cookies: &[CookieEntry],
) -> Option<(String, Option<String>)> {
    let api = BiliApi::from_cookies(cookies).ok()?;
    let body: WebInterfaceApiResponse = api
        .get(&format!("/x/web-interface/view?bvid={bvid}"))
        .await
        .ok()?
        .json()
        .await
        .ok()?;

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
async fn download_audio_with_fallback(
    app: &AppHandle,
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

    // Get segment concurrency from settings
    let settings = settings::get_settings(app).await.ok();
    let segment_concurrency = Settings::resolve_segment_concurrency(&settings);

    // Refetch inputs for attempt > 1 (bilibili signed URLs expire after 120 min).
    let a_refetch_cookies = refetch_ctx.cookies.clone();
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
        let cookies = a_refetch_cookies.clone();
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
                match refetch_dash_urls(app, &cookies, &bvid, a_cid, a_ep_id, -1, a_quality).await {
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

    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let res_body = fetch_video_title_by_bvid(id, &cookies).await?;
    let data = res_body.data.as_ref().unwrap();

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

    Ok(web_interface_data_to_video(
        data,
        id,
        replacements,
        auto_rename,
        is_limited_quality,
    ))
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

/// Converts API video/audio quality data to frontend DTO format.
///
/// Processes raw quality data from Bilibili API and converts it to a format usable by the frontend.
/// When multiple entries have the same quality ID, selects the one with the highest codec ID.
///
/// # Processing Steps
///
/// 1. Group entries by quality ID
/// 2. Select the highest codec ID for each quality level
/// 3. Sort in descending order (highest quality first)
///
/// # Arguments
///
/// * `video` - Quality data slice from XPlayer API response
///
/// # Returns
///
/// Returns a vector of `Quality` structs sorted by quality (highest first).
fn convert_qualities(video: &[XPlayerApiResponseVideo]) -> Vec<Quality> {
    let mut qualities: BTreeMap<i32, &XPlayerApiResponseVideo> = BTreeMap::new();

    for item in video {
        qualities
            .entry(item.id)
            .and_modify(|existing| {
                if item.codecid > existing.codecid {
                    *existing = item;
                }
            })
            .or_insert(item);
    }

    qualities
        .into_iter()
        .rev()
        .map(|(id, v)| Quality {
            id,
            codecid: v.codecid,
            quality: quality_to_string(&id),
        })
        .collect()
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
    let body: WebInterfaceApiResponse = api
        .get(&format!("/x/web-interface/view?bvid={bvid}"))
        .await?
        .json()
        .await
        .map_err(|e| format!("WebInterface Api Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
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
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    log::info!(
        "[BE] fetch_video_details: requesting bvid={}, cid={}",
        bvid,
        cid
    );
    let api = BiliApi::from_cookies(cookies)?;
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &api.http,
        (!api.cookie_header.is_empty()).then_some(&api.cookie_header),
    )
    .await?;

    let mut params = BTreeMap::from([
        ("bvid".to_string(), bvid.to_string()),
        ("cid".to_string(), cid.to_string()),
        ("qn".to_string(), "116".to_string()),
        ("fnval".to_string(), "2064".to_string()),
        ("fnver".to_string(), "0".to_string()),
        ("fourk".to_string(), "1".to_string()),
    ]);

    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid.clone()));
    query.push(("wts", signature.wts.clone()));

    let body: XPlayerApiResponse = api
        .get_q("/x/player/wbi/playurl", &query)
        .await?
        .json()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
    Ok(body)
}

/// Multi-process safe output-file reservation (issue #560).
///
/// Two app instances downloading to the same output filename used to race:
/// the old `auto_rename` checked `path.exists()` once at download start
/// (TOCTOU), so both processes could grab `video.mp4` and their ffmpeg merges
/// would overwrite each other. This reservation closes that window with two
/// OS-level primitives:
///
/// - `File::create_new` (O_EXCL) — exactly one process can create the
///   reservation file; creation is atomic, so there is no check-then-create
///   gap to slip through.
/// - an exclusive `flock` held on it for the download's lifetime — if the
///   owning process dies, the OS releases the lock, so the leftover
///   reservation is detectably dead and the next download reclaims it.
///
/// All output (direct durl downloads, ffmpeg merges) is written to the
/// reserved staging name (`{stem}.part.{ext}`) and only renamed to the
/// final user-visible name on success, so a crashed download can never leave
/// a half-written `video.mp4` behind — only a `.part` staging file,
/// which startup cleanup removes.
struct OutputReservation {
    /// Final user-visible path (e.g. `video.mp4`).
    final_path: PathBuf,
    /// Staging path all bytes are written to (e.g. `video.part.mp4`).
    reserved_path: PathBuf,
    /// Holds the exclusive flock for the download's lifetime. Releasing it
    /// (drop / process death) is what marks this reservation as reclaimable.
    lock_file: Option<File>,
    completed: bool,
}

impl OutputReservation {
    fn new(final_path: PathBuf, reserved_path: PathBuf, lock_file: File) -> Self {
        Self {
            final_path,
            reserved_path,
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
        self.lock_file = None; // release the flock
    }
}

/// Opens each temp path (creating it if absent) and holds an exclusive flock
/// for the caller's lifetime. Best-effort: an unpersistable path logs and is
/// skipped rather than failing the download (cleanup then falls back to the
/// age-based rule for that file).
fn lock_temp_paths(paths: &[&Path]) -> Vec<File> {
    let mut locked = Vec::with_capacity(paths.len());
    for path in paths {
        let file = match OpenOptions::new()
            .create(true)
            .write(true)
            .read(true)
            .open(path)
        {
            Ok(file) => file,
            Err(e) => {
                log::warn!(
                    "[BE] lock_temp_paths: open failed for {}: {}",
                    path.display(),
                    e
                );
                continue;
            }
        };
        if let Err(e) = file.lock_exclusive() {
            log::warn!(
                "[BE] lock_temp_paths: lock failed for {}: {}",
                path.display(),
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

/// Tries to claim `candidate` by atomically creating its staging file.
///
/// Returns `Some((locked_file, staging_path))` on success. On
/// `AlreadyExists`, checks whether the existing reservation is dead (its
/// holder crashed: flock gone) and if so reclaims it, so a crashed download
/// never blocks its filename for 24h. Returns `None` when the name is taken
/// by a live reservation or cannot be claimed.
fn try_claim(candidate: &Path) -> Option<(File, PathBuf)> {
    let reserved = part_path(candidate);
    match OpenOptions::new()
        .create_new(true)
        .write(true)
        .read(true)
        .open(&reserved)
    {
        Ok(file) => match file.lock_exclusive() {
            Ok(()) => Some((file, reserved)),
            // Locking a file only we just created should never fail; treat it
            // as claim failure rather than panicking.
            Err(_) => {
                let _ = fs::remove_file(&reserved);
                None
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            // Dead-holder reclamation: an exclusive try_lock on the existing
            // staging file succeeds only when no live process holds it.
            if let Ok(existing) = OpenOptions::new().write(true).read(true).open(&reserved) {
                if existing.try_lock_exclusive().is_ok() {
                    drop(existing);
                    let _ = fs::remove_file(&reserved);
                }
            }
            None
        }
        Err(_) => None,
    }
}

/// Reserves a unique output path for a download (issue #560).
///
/// Walks `desired`, `desired (1)`, ... until a staging file can be claimed
/// atomically. Falls back to a timestamp-based name if all 10,000 variants
/// are taken (mirrors the historical auto_rename behavior).
fn reserve_output_path(desired: &Path) -> Result<OutputReservation, String> {
    for candidate in candidate_output_paths(desired) {
        // Preserve the historical auto_rename contract: never target a name
        // whose final file already exists (a finished download).
        if candidate.exists() {
            continue;
        }
        // Two passes per candidate: the first pass may reclaim a dead
        // reservation, the second can then create_new it ourselves.
        for _ in 0..2 {
            if let Some((lock_file, reserved_path)) = try_claim(&candidate) {
                return Ok(OutputReservation::new(candidate, reserved_path, lock_file));
            }
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
    let Some((lock_file, reserved_path)) = try_claim(&fallback) else {
        return Err("ERR::OUTPUT_RESERVE_FAILED".to_string());
    };
    Ok(OutputReservation::new(fallback, reserved_path, lock_file))
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
    let settings = settings::get_settings(app)
        .await
        .map_err(|e| format!("Failed to get settings: {e}"))?;
    let output_path = settings
        .dl_output_path
        .ok_or_else(|| "Download output path is not configured".to_string())?;

    let filename_with_ext = if filename.to_lowercase().ends_with(".mp4") {
        filename.to_string()
    } else {
        format!("{filename}.mp4")
    };

    Ok(PathBuf::from(&output_path).join(filename_with_ext))
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
    let client = build_client().ok()?;
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
/// Uses `statvfs` to check available disk space at the target location.
/// Currently only implemented for Unix-like systems. Does nothing on other platforms.
///
/// # Arguments
///
/// * `target_path` - Path where file will be saved (checks parent directory)
/// * `needed_bytes` - Required disk space in bytes
///
/// # Returns
///
/// Returns `Ok(())` if sufficient space is available or on non-Unix systems.
///
/// # Errors
///
/// Returns `ERR::DISK_FULL` if available space is less than needed.
fn ensure_free_space(target_path: &Path, needed_bytes: u64) -> Result<(), String> {
    #[cfg(target_family = "unix")]
    {
        use libc::statvfs;
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::unix::ffi::OsStrExt;

        let dir = target_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let c_path =
            CString::new(dir.as_os_str().as_bytes()).map_err(|_| "ERR::DISK_FULL".to_string())?;
        unsafe {
            let mut stat = MaybeUninit::<statvfs>::uninit();
            if statvfs(c_path.as_ptr(), stat.as_mut_ptr()) != 0 {
                return Ok(());
            }
            let stat = stat.assume_init();
            #[allow(clippy::unnecessary_cast, clippy::useless_conversion)]
            let free_bytes = u64::from(stat.f_bavail) * stat.f_frsize;
            if free_bytes < needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Not implemented on Windows, etc. -> skip
    Ok(())
}

/// Retries download operations up to 3 times with linear backoff.
///
/// Implements retry logic for transient network failures originating from
/// `download_url`. Errors are classified by prefix:
///
/// - `ERR::` prefix: Business logic errors (e.g. `ERR::DISK_FULL`,
///   `ERR::CANCELLED`, `ERR::FILE_EXISTS`) are passed through immediately
///   without retry.
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
/// - Final failure is wrapped as `ERR::NETWORK::{original_message}`
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
/// - All retry attempts failed (wrapped as `ERR::NETWORK::*`)
/// - Error contains `ERR::` prefix (passed through unchanged)
async fn retry_download<F, Fut>(
    app: &AppHandle,
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

                // ERR:: prefix = business logic error, never retry
                if msg.contains("ERR::") {
                    log::warn!("[BE] retry_download: non-retryable: {msg}");
                    if attempt > 1 {
                        emit_retrying(false);
                    }
                    return Err(msg);
                }

                // Non-ERR:: errors from download_url are network-related.
                // Retry unconditionally; final attempt wraps as ERR::NETWORK.
                if attempt >= MAX_ATTEMPTS {
                    log::error!("[BE] retry_download: exhausted {MAX_ATTEMPTS} attempts: {msg}");
                    if attempt > 1 {
                        emit_retrying(false);
                    }
                    return Err(format!("ERR::NETWORK::{msg}"));
                }

                log::warn!("[BE] retry_download: attempt {attempt}/{MAX_ATTEMPTS} failed: {msg}");
                tokio::time::sleep(Duration::from_millis(BACKOFF_BASE_MS * attempt as u64)).await;
            }
        }
    }

    unreachable!()
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
    quality: i32,
) -> Result<(String, Option<Vec<String>>, bool), String> {
    items
        .iter()
        .find(|v| v.id == quality)
        .map(|v| (v.base_url.clone(), v.backup_urls.clone(), false))
        .or_else(|| {
            items
                .first()
                .map(|v| (v.base_url.clone(), v.backup_urls.clone(), true))
        })
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into())
}

/// Resolves the user's codec priority and filters video streams accordingly.
///
/// Reads the codec priority setting once and returns:
/// - The streams to use for quality selection: filtered by the preferred
///   codec, or all streams when the preferred codec is unavailable for any
///   quality (so the download never fails).
/// - The codec selection result, used by callers to detect codec fallback.
///   `None` means no priority codec was available at all (caller treats this
///   as a codec fallback for warning purposes).
///
/// Shared by `download_video` and `refetch_dash_urls` to keep the codec
/// selection logic in a single place.
async fn select_streams_by_codec_priority(
    app: &AppHandle,
    video_streams: &[XPlayerApiResponseVideo],
) -> (Vec<XPlayerApiResponseVideo>, Option<VideoStreamSelection>) {
    let codec_priority = settings::get_settings(app)
        .await
        .ok()
        .and_then(|s| s.video_codec_priority)
        .unwrap_or_default();

    let available_codecs: Vec<i16> = video_streams.iter().map(|v| v.codecid).collect();
    let codec_selection = select_video_stream(&codec_priority, &available_codecs);

    let filtered: Vec<_> = video_streams
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
        (video_streams.to_vec(), codec_selection)
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

    // 2. API call
    // Omit parameters on first request; use max/view_at for subsequent pages
    let api = BiliApi::from_cookie_header(cookie_header)?;
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
pub async fn fetch_subtitles(
    client: &Client,
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Vec<SubtitleDto> {
    log::info!(
        "[BE] fetch_subtitles: starting for bvid={}, cid={}",
        bvid,
        cid
    );

    let cookie_header = build_cookie_header(cookies);
    if cookie_header.is_empty() {
        log::warn!(
            "[BE] fetch_subtitles: no cookies available, \
             subtitles require login"
        );
        return Vec::new();
    }

    // WBI-signed access. The unsigned `/x/player/v2` endpoint is
    // unreliable: Bilibili's CDN returns stale cached responses that
    // contain only a partial AI subtitle set. The signed `/wbi/v2`
    // endpoint returns the full set in a single request.
    let mixin_key = match crate::utils::wbi::fetch_mixin_key(client, Some(&cookie_header)).await {
        Ok(k) => k,
        Err(e) => {
            log::error!("[BE] fetch_subtitles: failed to fetch WBI mixin key: {}", e);
            return Vec::new();
        }
    };

    let mut params = BTreeMap::from([
        ("bvid".to_string(), bvid.to_string()),
        ("cid".to_string(), cid.to_string()),
    ]);
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    let mut query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    query.push(("w_rid", signature.w_rid));
    query.push(("wts", signature.wts));

    // Transport errors (send failure or non-2xx status) both soft-fail here.
    let response = match BiliApi::new(Client::clone(client), API_BASE, cookie_header)
        .get_q("/x/player/wbi/v2", &query)
        .await
    {
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
    let client = build_client()?;
    let subtitles = fetch_subtitles(&client, &cookies, bvid, cid).await;

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
/// Returns `(video_qualities, audio_qualities)` tuple:
/// - `video_qualities` - List of available video qualities
/// - `audio_qualities` - List of available audio qualities (empty for durl format)
pub async fn fetch_part_qualities(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>), String> {
    log::info!(
        "[BE] fetch_part_qualities: requesting qualities for bvid={}, cid={}",
        bvid,
        cid
    );
    let cookies = read_cookie(app)?.unwrap_or_default();
    let details = fetch_video_details(&cookies, bvid, cid).await?;
    let data = details.data.ok_or("ERR::NO_STREAM")?;

    // DASH format: separate video and audio streams
    if let Some(dash) = data.dash {
        let video_qualities = convert_qualities(&dash.video);
        let audio_qualities = convert_qualities(&dash.audio);
        log::info!(
            "[BE] fetch_part_qualities: received {} video qualities, {} audio qualities",
            video_qualities.len(),
            audio_qualities.len()
        );
        return Ok((video_qualities, audio_qualities));
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
        // durl format has no separate audio stream
        return Ok((video_qualities, vec![]));
    }

    Err("ERR::NO_STREAM".to_string())
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
/// Returns an error if the HTTP client cannot be constructed.
#[allow(clippy::too_many_arguments)]
async fn prepare_subtitle_mode(
    app: &AppHandle,
    subtitle_opts: &Option<SubtitleOptions>,
    cookies: &[CookieEntry],
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

    let client = build_client()?;

    // Emit a "subtitle" progress stage so the frontend can surface that the
    // subtitle download is running. Without this, the UI stays frozen at
    // audio/video 100% for the whole fetch + retry loop and looks hung.
    // Why a single emit with no periodic updates: subtitle payloads are small
    // and fetched in parallel per language, so there is no meaningful
    // byte-level progress to stream — the frontend renders this as an
    // indeterminate "downloading..." state.
    // Why after build_client: on client construction failure we return early
    // without emitting, so no orphan "subtitle" entry is left in the
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
        let subs = fetch_subtitles(&client, cookies, bvid, cid).await;
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
            let fresh = fetch_subtitles(&client, cookies, bvid, cid).await;
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
                let client = client.clone();
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
    cookies: &[CookieEntry],
    ep_id: i64,
    cid: i64,
) -> Result<BangumiPlayerResult, String> {
    let cookie_header = build_cookie_header(cookies);
    let api = BiliApi::from_cookie_header(cookie_header)?;

    let response = api
        .get(&format!(
            "/pgc/player/web/playurl?ep_id={}&cid={}&qn=116&fnval=2064&fnver=0&fourk=1",
            ep_id, cid
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
    cookies: &[CookieEntry],
    ep_id: i64,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    let result = fetch_bangumi_player_result(cookies, ep_id, cid).await?;
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
struct AudioRefetchCtx {
    cookies: Vec<CookieEntry>,
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
    app: &AppHandle,
    cookies: &[CookieEntry],
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
        fetch_bangumi_details_for_download(cookies, ep, cid).await?
    } else {
        fetch_video_details(cookies, bvid, cid).await?
    };
    let data = details
        .data
        .ok_or_else(|| "refetch_dash_urls: playurl response has no data".to_string())?;
    let dash = data
        .dash
        .ok_or_else(|| "refetch_dash_urls: playurl response has no dash".to_string())?;

    // Reuse the same codec-aware stream selection as the initial download so
    // a retry picks the same codec (keeps the merged output consistent).
    let (streams_for_selection, _) = select_streams_by_codec_priority(app, &dash.video).await;
    let (video_url, video_backup_urls, _) =
        select_stream_url(&streams_for_selection, video_quality)?;
    let resolved_audio_quality =
        audio_quality.unwrap_or_else(|| dash.audio.first().map(|a| a.id).unwrap_or(30280));
    let (audio_url, audio_backup_urls, _) = select_stream_url(&dash.audio, resolved_audio_quality)?;
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
    cookies: &[CookieEntry],
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
        let result = fetch_bangumi_player_result(cookies, ep, cid).await?;
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
        let details = fetch_video_details(cookies, bvid, cid).await?;
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
    let result = fetch_bangumi_player_result(&cookies, ep_id, cid).await?;

    let is_preview = result.is_preview.map(|v| v == 1);

    // Try DASH format first
    if let Some(dash) = &result.dash {
        let video_qualities = convert_qualities(&dash.video);
        let audio_qualities = convert_qualities(&dash.audio);
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
