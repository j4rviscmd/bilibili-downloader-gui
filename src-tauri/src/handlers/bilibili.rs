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

use crate::constants::REFERER;
use crate::handlers::cookie::read_cookie;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    BangumiPlayerApiResponse, BangumiPlayerResult, BangumiSeasonApiResponse, PlayerV2ApiResponse,
    UserApiResponse, WatchHistoryApiResponse, WebInterfaceApiResponse, XPlayerApiResponse,
    XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{
    DownloadRetrying, Quality, SubtitleDto, Thumbnail, UserData, Video, VideoPart,
    WatchHistoryCursor, WatchHistoryEntry,
};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::header;
use reqwest::Client;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
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
/// ```
/// let client = build_client()?;
/// let response = client.get("https://api.bilibili.com/...").send().await?;
/// ```
pub fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))
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
/// ```
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
    player_result: BangumiPlayerResult,
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
            audio_quality: None, // durl format has no separate audio
            audio_quality_fallback: false,
            is_preview,
        },
    )
    .ok();

    // Capacity check
    if let Some(vs) = head_content_length(video_url, Some(cookie_header)).await {
        let total_needed = vs + (5 * 1024 * 1024); // 5MB buffer
        ensure_free_space(output_path, total_needed)?;
    }

    // Download directly. Capture the result so we always remove the token
    // (success or error) to avoid a registry leak on the early-return path.
    let result = retry_download(app, &options.download_id, Some("video"), || {
        download_url(
            app,
            video_url.clone(),
            backup_urls.clone(),
            output_path.to_path_buf(),
            Some(cookie_header.to_string()),
            true,
            Some(options.download_id.clone()),
            Some("video"),
            true,
        )
    })
    .await;

    // Always remove the cancellation token (success or error).
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;

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

    // 1. Determine output file path + auto-rename
    let output_path = auto_rename(&build_output_path(app, &options.filename).await?);

    // 2. Get cookies (WBI signing enables non-logged-in usage)
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);

    // 3. For bangumi, fetch player result to check is_preview and durl format
    let bangumi_preview_info: Option<bool> = if let Some(ep_id) = options.ep_id {
        let player_result = fetch_bangumi_player_result(&cookies, ep_id, options.cid).await?;
        let is_preview = player_result.is_preview.map(|v| v == 1);

        // durl format (direct MP4 URL)
        if player_result.dash.is_none() {
            return download_bangumi_durl(
                app,
                options,
                &output_path,
                &cookie_header,
                player_result,
            )
            .await;
        }
        is_preview
    } else {
        None
    };

    // 4. Fetch video details (extract URL for selected quality) - DASH format
    let details = if let Some(ep_id) = options.ep_id {
        fetch_bangumi_details_for_download(&cookies, ep_id, options.cid).await?
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
                    audio_quality: None, // durl format has no separate audio
                    audio_quality_fallback: false,
                    is_preview: None,
                },
            )
            .ok();

            if let Some(vs) = head_content_length(&video_url, Some(&cookie_header)).await {
                ensure_free_space(&output_path, vs + 5 * 1024 * 1024)?;
            }

            retry_download(app, &options.download_id, Some("video"), || {
                download_url(
                    app,
                    video_url.clone(),
                    backup_urls.clone(),
                    output_path.to_path_buf(),
                    Some(cookie_header.to_string()),
                    true,
                    Some(options.download_id.clone()),
                    Some("video"),
                    true,
                )
            })
            .await?;

            let output_path_str = output_path.to_string_lossy().to_string();
            let actual_file_size = tokio::fs::metadata(&output_path)
                .await
                .ok()
                .map(|m| m.len());
            spawn_save_to_history(app, options, actual_file_size);
            Ok(output_path_str)
        }
        .await;

        // Cleanup: remove token and clear the pre-cancel flag (this path
        // bypasses download_video's final cleanup).
        DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;
        DOWNLOAD_CANCEL_REGISTRY
            .clear_cancelled(&options.download_id)
            .await;

        return result;
    }

    let dash_data = data.dash.unwrap();

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

    // Fallback if selected quality is unavailable (first = highest quality)
    // None means best available → -1 won't match any real quality ID.
    let requested_quality = options.quality.unwrap_or(-1);
    let (video_url, video_backup_urls, raw_video_fallback) =
        select_stream_url(&dash_data.video, requested_quality)?;
    // Only treat as fallback when the user explicitly selected a quality.
    // When quality is None (accordion never opened), the best-available
    // selection is intentional and should not trigger the warning icon.
    let video_quality_fallback = options.quality.is_some() && raw_video_fallback;
    // Get the actual resolved video quality ID
    let resolved_video_quality = dash_data
        .video
        .iter()
        .find(|v| v.base_url == video_url)
        .map(|v| v.id)
        .unwrap_or(requested_quality);

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
        ensure_free_space(&output_path, total_needed)?;
    }

    // 6. Generate temp file paths
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", options.download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", options.download_id));

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
        let audio_download = download_audio_with_fallback(
            app,
            &options.download_id,
            audio_url.clone(),
            audio_backup_urls.clone(),
            temp_audio_path.clone(),
            cookie.clone(),
            &dash_data.audio,
        );
        let video_download = retry_download(app, &options.download_id, Some("video"), || {
            download_url(
                app,
                video_url.clone(),
                video_backup_urls.clone(),
                temp_video_path.clone(),
                cookie.clone(),
                true,
                Some(options.download_id.clone()),
                None,
                false, // emit_complete: will be emitted after merge
            )
        });

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
                &options.subtitle,
                &cookies,
                &options.bvid,
                options.cid,
                &options.download_id,
                &lib_path,
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
            &output_path,
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

        // Keep output path (clone for history saving)
        let output_path_str = output_path.to_string_lossy().to_string();

        // Get actual file size
        let actual_file_size = tokio::fs::metadata(&output_path)
            .await
            .ok()
            .map(|m| m.len());

        log::info!(
            "[BE] download_video: download complete id={}, size={:?}bytes",
            options.download_id,
            actual_file_size
        );

        // Save to history (async failure does not affect download)
        spawn_save_to_history(app, options, actual_file_size);

        Ok(output_path_str)
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
/// ```no_run
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
/// ```rust
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
    let client = build_client().ok()?;
    let cookie_header = build_cookie_header(cookies);
    let url = format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}");

    let response = client
        .get(url)
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .ok()?;
    check_http_status(response.status()).ok()?;
    let body: WebInterfaceApiResponse = response.json().await.ok()?;

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
async fn download_audio_with_fallback(
    app: &AppHandle,
    download_id: &str,
    primary_url: String,
    backup_urls: Option<Vec<String>>,
    output_path: PathBuf,
    cookie: Option<String>,
    all_audio_streams: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
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

    // Try primary URL first
    let primary_result = retry_download(app, download_id, Some("audio"), || {
        download_url(
            app,
            primary_url.clone(),
            backup_urls.clone(),
            output_path.clone(),
            cookie.clone(),
            true,
            Some(download_id.to_string()),
            None,
            false,
        )
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

                    let fallback_result = retry_download(app, download_id, Some("audio"), || {
                        download_url(
                            app,
                            stream.base_url.clone(),
                            stream.backup_urls.clone(),
                            output_path.clone(),
                            cookie.clone(),
                            true,
                            Some(download_id.to_string()),
                            None,
                            false,
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

    let client = build_client()?;
    let response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;
    check_http_status(response.status())?;
    let body = response
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
    use crate::utils::sanitize::{apply_title_replacements, resolve_duplicate_titles};

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

    // Get settings for title replacement
    let settings = settings::get_settings(app).await.ok();
    let replacements = settings
        .as_ref()
        .and_then(|s| s.title_replacements.as_deref());
    let auto_rename = settings
        .as_ref()
        .and_then(|s| s.auto_rename_duplicates)
        .unwrap_or(true);

    // Apply title replacement to the main title
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
                // Apply title replacement to part name
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

    Ok(Video {
        title: sanitized_title,
        bvid: id.to_string(),
        parts,
        is_limited_quality,
        content_type: "video".to_string(),
        ep_id: None,
        season_title: None,
    })
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
    let client = build_client()?;
    let url = format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}");

    let response = client
        .get(url)
        .header(header::COOKIE, build_cookie_header(cookies))
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("WebInterface Api Failed to fetch video info: {e}"))?;
    check_http_status(response.status())?;
    let body: WebInterfaceApiResponse = response
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
    let client = build_client()?;
    let cookie_header = build_cookie_header(cookies);
    let mixin_key = crate::utils::wbi::fetch_mixin_key(
        &client,
        if cookie_header.is_empty() {
            None
        } else {
            Some(&cookie_header)
        },
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

    let response = client
        .get("https://api.bilibili.com/x/player/wbi/playurl")
        .header(header::COOKIE, build_cookie_header(cookies))
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;
    check_http_status(response.status())?;
    let body: XPlayerApiResponse = response
        .json()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
    Ok(body)
}

/// Automatically renames file if it already exists.
///
/// If the original path exists, appends a counter (e.g., "filename (1).mp4")
/// to generate a unique filename. Searches up to 10,000 variations,
/// falling back to a timestamp-based name if all are duplicates.
///
/// # Arguments
///
/// * `path` - Original file path to check
///
/// # Returns
///
/// Returns the original path if it doesn't exist.
/// Returns a renamed path with counter appended if it exists (e.g., "file (1).mp4").
fn auto_rename(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");

    for idx in 1..=10_000u32 {
        let new_name = format!("{} ({}).{}", stem, idx, ext);
        let new_path = parent.join(new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: use timestamp to ensure uniqueness
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fallback_name = format!("{}_{}.{}", stem, timestamp, ext);
    parent.join(fallback_name)
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
    F: FnMut() -> Fut,
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
        match f().await {
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
/// ```rust
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
    let client = build_client()?;
    let url = if max == 0 && view_at == 0 {
        "https://api.bilibili.com/x/web-interface/history/cursor?business=archive".to_string()
    } else {
        format!(
            "https://api.bilibili.com/x/web-interface/history/cursor?max={}&view_at={}&business=archive",
            max, view_at
        )
    };

    let response = client
        .get(&url)
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch watch history: {e}"))?;

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
/// - Uses `/x/player/v2` with Cookie authentication (per API docs, WBI signature is optional)
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

    let response = match client
        .get("https://api.bilibili.com/x/player/v2")
        .header(header::COOKIE, &cookie_header)
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&[("bvid", bvid), ("cid", &cid.to_string())])
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("[BE] fetch_subtitles: HTTP request failed: {}", e);
            return Vec::new();
        }
    };

    let status = response.status();
    if !status.is_success() {
        log::error!(
            "[BE] fetch_subtitles: API returned \
             non-success status: {}",
            status
        );
        return Vec::new();
    }

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
/// Stale CDN mitigation is handled by [`fetch_subtitles_parallel`].
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
    let subtitles = fetch_subtitles_parallel(&client, &cookies, bvid, cid).await;

    log::info!(
        "[BE] fetch_subtitles_for_part: received {} subtitles",
        subtitles.len()
    );
    Ok(subtitles)
}

/// Merges multiple subtitle lists, deduplicating by `lan` (language code).
///
/// When the same `lan` appears in multiple results, the first occurrence
/// is kept. This ensures each language appears at most once, which is
/// required because the downstream download pipeline selects subtitles
/// by `lan` alone and cannot handle duplicates.
fn merge_subtitles(results: Vec<Vec<SubtitleDto>>) -> Vec<SubtitleDto> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut merged: Vec<SubtitleDto> = Vec::new();

    for subtitles in results {
        for sub in subtitles {
            if seen.insert(sub.lan.clone()) {
                merged.push(sub);
            }
        }
    }

    merged
}

/// Fetches subtitles via parallel requests to mitigate stale CDN cache.
///
/// Bilibili's CDN may return stale cached responses that contain only a single
/// AI subtitle (`ai_type: 0`) instead of the full set of AI-translated
/// subtitles (`ai_type: 1`). Rather than retrying sequentially, this function
/// issues [`PARALLEL_COUNT`] concurrent requests with small inter-request
/// jitter, increasing the probability of hitting a fresh CDN node.
/// All results are merged and deduplicated via [`merge_subtitles`].
///
/// # Arguments
///
/// * `client` - HTTP client used for API requests
/// * `cookies` - Cookie entries for authentication
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns the merged and deduplicated subtitle list from all parallel
/// attempts. Returns an empty vector if all requests fail.
async fn fetch_subtitles_parallel(
    client: &Client,
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Vec<SubtitleDto> {
    const PARALLEL_COUNT: usize = 3;
    const JITTER_STEP_MS: u64 = 1000;

    let futures: Vec<_> = (0..PARALLEL_COUNT)
        .map(|i| {
            let jitter_ms = (i as u64) * JITTER_STEP_MS;
            async move {
                if jitter_ms > 0 {
                    tokio::time::sleep(Duration::from_millis(jitter_ms)).await;
                }
                fetch_subtitles(client, cookies, bvid, cid).await
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    for (i, subs) in results.iter().enumerate() {
        log::info!(
            "[BE] fetch_subtitles_parallel: request {} returned \
             {} subtitles for bvid={}, cid={}",
            i,
            subs.len(),
            bvid,
            cid,
        );
    }

    let merged = merge_subtitles(results);

    log::info!(
        "[BE] fetch_subtitles_parallel: merged into {} unique \
         subtitles for bvid={}, cid={}",
        merged.len(),
        bvid,
        cid,
    );

    merged
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
///
/// # Errors
///
/// Returns errors in the following cases:
/// - Download failure
/// - Non-success HTTP response
/// - JSON parse failure
/// - File write failure
pub async fn download_subtitle(
    client: &Client,
    subtitle_url: &str,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let url = if subtitle_url.starts_with("//") {
        format!("https:{}", subtitle_url)
    } else {
        subtitle_url.to_string()
    };

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download subtitle: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bcc: crate::models::bilibili_api::BccSubtitle = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse subtitle JSON: {}", e))?;

    let srt_content = crate::utils::subtitle::bcc_to_srt(&bcc);

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
) -> Result<(), String> {
    const MAX_RETRIES: usize = 3;
    const BASE_DELAY_SECS: u64 = 2;

    for attempt in 0..MAX_RETRIES {
        match download_subtitle(client, subtitle_url, output_path).await {
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
async fn prepare_subtitle_mode(
    subtitle_opts: &Option<SubtitleOptions>,
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
    download_id: &str,
    lib_path: &Path,
) -> Result<(crate::handlers::ffmpeg::MergeMode, Vec<String>, Vec<String>), String> {
    use crate::handlers::ffmpeg::{MergeMode, SubtitleMergeOptions};
    use crate::utils::subtitle::lan_to_iso639;

    let sub_opts = match subtitle_opts {
        Some(opts) if opts.mode != "off" && !opts.selected_lans.is_empty() => opts,
        _ => return Ok((MergeMode::None, vec![], vec![])),
    };

    let client = build_client()?;

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
        let subs = fetch_subtitles_parallel(&client, cookies, bvid, cid).await;
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
            let fresh = fetch_subtitles_parallel(&client, cookies, bvid, cid).await;
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
                    let result =
                        download_subtitle_with_retry(&client, &sub.subtitle_url, &srt_path).await;
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

    let client = build_client()?;
    let url = format!(
        "https://api.bilibili.com/pgc/view/web/season?ep_id={}",
        ep_id
    );

    let response = client
        .get(&url)
        .header(header::COOKIE, &cookie_header)
        .header(header::REFERER, "https://www.bilibili.com")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch bangumi info: {}", e))?;

    check_http_status(response.status())?;
    let body: BangumiSeasonApiResponse = response
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
    let client = build_client()?;
    let cookie_header = build_cookie_header(cookies);

    let url = format!(
        "https://api.bilibili.com/pgc/player/web/playurl?ep_id={}&cid={}&qn=116&fnval=2064&fnver=0&fourk=1",
        ep_id, cid
    );

    let response = client
        .get(&url)
        .header(header::COOKIE, &cookie_header)
        .header(header::REFERER, "https://www.bilibili.com")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch bangumi playurl: {}", e))?;

    check_http_status(response.status())?;

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

    match result.dash {
        Some(dash) => Ok(XPlayerApiResponse {
            code: 0,
            message: "success".to_string(),
            data: Some(crate::models::bilibili_api::XPlayerApiResponseData {
                dash: Some(dash),
                durl: None,
                support_formats: None,
                quality: None,
            }),
        }),
        None => {
            // durl format - not supported in current download flow
            // This will be handled by download_video with durl support
            Err("ERR::BANGUMI_DURL_NOT_SUPPORTED".into())
        }
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
/// ```rust
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

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("ERR::SHORT_URL_EXPAND: {}", e))?;

    Ok(response.url().to_string())
}
