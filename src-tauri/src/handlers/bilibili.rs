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
    Quality, SubtitleDto, Thumbnail, UserData, Video, VideoPart, WatchHistoryCursor,
    WatchHistoryEntry,
};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::header;
use reqwest::Client;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Builds a reqwest HTTP client with the default user agent.
///
/// Creates a new HTTP client configured with the application's user agent
/// for making requests to Bilibili's API.
///
/// # Returns
///
/// Returns the configured HTTP client on success.
///
/// # Errors
///
/// Returns an error if the client builder fails to create the client.
pub fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))
}

/// Validates a Bilibili API response. Returns an error if the response code is non-zero or data is None.
fn validate_api_response<T>(code: i64, data: Option<&T>) -> Result<(), String> {
    match code {
        -404 => Err("ERR::VIDEO_NOT_FOUND".into()),
        0 if data.is_some() => Ok(()),
        _ => Err("ERR::API_ERROR".into()),
    }
}

/// Checks HTTP response status and returns appropriate error codes.
/// Returns `ERR::RATE_LIMITED` for HTTP 429, `ERR::API_ERROR` for other errors.
fn check_http_status(status: reqwest::StatusCode) -> Result<(), String> {
    match status.as_u16() {
        200..=299 => Ok(()),
        429 => Err("ERR::RATE_LIMITED".into()),
        _ => Err("ERR::API_ERROR".into()),
    }
}

/// Extracts bangumi episode ID from a redirect URL.
///
/// Parses URLs like `https://www.bilibili.com/bangumi/play/ep3051843`
/// and returns the episode ID (3051843).
///
/// # Arguments
///
/// * `url` - The redirect URL to parse
///
/// # Returns
///
/// Returns `Some(ep_id)` if the URL matches the bangumi pattern, `None` otherwise.
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

/// Downloads a bangumi episode using durl format (MP4 direct URL).
/// This is used when DASH format is not available for bangumi content.
///
/// In durl format, audio is embedded in the video file, so no separate
/// audio download or ffmpeg merge is needed.
async fn download_bangumi_durl(
    app: &AppHandle,
    options: &DownloadOptions,
    output_path: &Path,
    cookie_header: &str,
    player_result: BangumiPlayerResult,
) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // Register cancellation token
    let _cancel_token = DOWNLOAD_CANCEL_REGISTRY
        .register(&options.download_id)
        .await;

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

    // Download directly
    retry_download(|| {
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
    let actual_file_size = tokio::fs::metadata(output_path).await.ok().map(|m| m.len());

    // Remove cancellation token
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;

    // Save to history asynchronously
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
            actual_file_size,
            &filename,
            thumbnail_url,
            page,
        )
        .await
        {
            eprintln!("Warning: Failed to save to history for {bvid}: {e}");
        }
    });

    Ok(output_path_str)
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

    // Register cancellation token for this download
    let _cancel_token = DOWNLOAD_CANCEL_REGISTRY
        .register(&options.download_id)
        .await;

    // 1. 出力ファイルパス決定 + 自動リネーム
    let output_path = auto_rename(&build_output_path(app, &options.filename).await?);

    // 2. Cookie取得（WBI署名により非ログインユーザでも動作）
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);

    // 3. バンガミの場合、プレイヤー結果を取得してis_previewとdurl形式をチェック
    let bangumi_preview_info: Option<bool> = if let Some(ep_id) = options.ep_id {
        let player_result = fetch_bangumi_player_result(&cookies, ep_id, options.cid).await?;
        let is_preview = player_result.is_preview.map(|v| v == 1);

        // durl形式（MP4直接URL）の場合
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

    // 4. 動画詳細取得 (選択品質のURL抽出) - DASH形式
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

    // 通常動画 durl 形式（音声が映像に埋め込まれているMP4）
    if data.dash.is_none() {
        if let Some(durl_segments) = &data.durl {
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

            retry_download(|| {
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
                    actual_file_size,
                    &filename,
                    thumbnail_url,
                    page,
                )
                .await
                {
                    eprintln!("Warning: Failed to save to history for {bvid}: {e}");
                }
            });
            return Ok(output_path_str);
        }
        return Err("ERR::NO_STREAM".to_string());
    }

    let dash_data = data.dash.unwrap();

    // 選択品質が存在しなければフォールバック (先頭 = 最も高品質)
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

    // 5. 容量事前チェック (取得できなければスキップ)
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 余裕 5MB
        ensure_free_space(&output_path, total_needed)?;
    }

    // 6. temp ファイルパス生成
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", options.download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", options.download_id));

    // Result to track success/failure for cleanup
    let result = async {
        // 7. セマフォ取得 + 並列ダウンロード + マージ
        // セマフォは「マージ完了まで保持」され、並列実行数はマージ処理の負荷に基づく
        let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

        let cookie = Some(cookie_header);

        // 音声と動画を並列ダウンロード (片方失敗で即時キャンセル)
        tokio::try_join!(
            retry_download(|| {
                download_url(
                    app,
                    audio_url.clone(),
                    audio_backup_urls.clone(),
                    temp_audio_path.clone(),
                    cookie.clone(),
                    true,
                    Some(options.download_id.clone()),
                    None,
                    false, // emit_complete: will be emitted after merge
                )
            }),
            retry_download(|| {
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
            }),
        )?;

        // 字幕処理
        let (subtitle_mode, subtitle_language_labels) = prepare_subtitle_mode(
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

        // 字幕ファイルのパスを保持（クリーンアップ用）
        let subtitle_paths: Vec<PathBuf> = match &subtitle_mode {
            crate::handlers::ffmpeg::MergeMode::SoftSub(subs) => {
                subs.iter().map(|s| s.path.clone()).collect()
            }
            crate::handlers::ffmpeg::MergeMode::HardSub(sub) => {
                vec![sub.path.clone()]
            }
            _ => vec![],
        };

        // マージ実行
        crate::handlers::ffmpeg::merge_avs(
            app,
            &temp_video_path,
            &temp_audio_path,
            &output_path,
            Some(options.download_id.clone()),
            Some((options.duration_seconds * 1000) as u64),
            subtitle_mode,
        )
        .await
        .map_err(|_| String::from("ERR::MERGE_FAILED"))?;

        // マージ完了後にセマフォを解放
        drop(permit);

        // temp 削除
        let _ = tokio::fs::remove_file(&temp_video_path).await;
        let _ = tokio::fs::remove_file(&temp_audio_path).await;
        for sub_path in subtitle_paths {
            let _ = tokio::fs::remove_file(&sub_path).await;
        }

        // 出力パスを保持 (クローンで履歴保存に渡す)
        let output_path_str = output_path.to_string_lossy().to_string();

        // 実際のファイルサイズを取得
        let actual_file_size = tokio::fs::metadata(&output_path)
            .await
            .ok()
            .map(|m| m.len());

        // 履歴に保存 (非同期で失敗してもダウンロードには影響しない)
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
                actual_file_size,
                &filename,
                thumbnail_url,
                page,
            )
            .await
            {
                eprintln!("Warning: Failed to save to history for {bvid}: {e}");
            }
        });

        Ok(output_path_str)
    }
    .await;

    // Cleanup: Remove cancellation token from registry
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;

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

    let page_suffix = page.map_or(String::new(), |p| format!("?p={p}"));

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

/// Fetches video information for a history entry.
///
/// Used to retrieve video title and thumbnail when saving download history.
/// Returns `None` on any failure (network error, API error, etc.).
///
/// # Arguments
///
/// * `bvid` - Bilibili video ID
/// * `cookies` - Cookie entries for authentication
///
/// # Returns
///
/// Returns `Some((title, thumbnail_url))` on success, or `None` on failure.
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

/// Fetches logged-in user information from Bilibili. Returns a User with is_login=false if no cookies exist.
pub async fn fetch_user_info(app: &AppHandle) -> Result<User, String> {
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
/// Filters cookies to only include those from bilibili.com domains
/// and formats them as "name=value; name=value".
///
/// # Arguments
///
/// * `cookies` - Slice of cookie entries to filter and format
///
/// # Returns
///
/// Cookie header string (may be empty if no matching cookies).
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
/// This function requires cookies to be present; returns an error if the cache is empty.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
///
/// # Returns
///
/// Returns the cookie header string on success.
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
    use crate::utils::sanitize::apply_title_replacements;

    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let res_body = fetch_video_title_by_bvid(id, &cookies).await?;
    let data = res_body.data.as_ref().unwrap();

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

    // Apply title replacement to the main title
    let sanitized_title = apply_title_replacements(&data.title, replacements);

    let pages = data.pages.as_deref().unwrap_or(&[]);

    let parts = if pages.is_empty() {
        vec![VideoPart {
            cid: data.cid,
            page: 1,
            part: sanitized_title.clone(),
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
                    part: sanitized_part,
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
/// Processes raw quality data from the Bilibili API:
/// 1. Groups qualities by ID
/// 2. Selects the highest codec ID for each quality level
/// 3. Sorts in descending order (highest quality first)
///
/// # Arguments
///
/// * `video` - Slice of quality data from XPlayer API response
///
/// # Returns
///
/// Vector of `Quality` structs sorted by quality (highest first).
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

/// Fetches video title and page information from the Bilibili Web Interface API.
///
/// Retrieves basic video metadata including title, thumbnail, and page list.
/// This is the first API call when fetching video info.
///
/// # Arguments
///
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cookies` - Cookie entries for authentication (optional but recommended)
///
/// # Returns
///
/// Returns the raw API response containing video data.
///
/// # Errors
///
/// Returns an error if:
/// - Network request fails
/// - HTTP status is not successful
/// - API returns non-zero code
/// - Video is not found (`ERR::VIDEO_NOT_FOUND`)
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

    let query: Vec<(&str, String)> = params
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect::<Vec<_>>()
        .into_iter()
        .chain([
            ("w_rid", signature.w_rid.clone()),
            ("wts", signature.wts.clone()),
        ])
        .collect();

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

/// Automatically renames a file if it already exists.
///
/// Generates a unique filename by appending a counter (e.g., "filename (1).mp4")
/// if the original path exists. Searches up to 10,000 variations before
/// falling back to a timestamp-based name.
///
/// # Arguments
///
/// * `path` - Original file path to check
///
/// # Returns
///
/// Returns the original path if it doesn't exist, or a renamed path
/// with an appended counter (e.g., "file (1).mp4").
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

/// Builds the complete output path for a download file.
///
/// Combines the user's configured download directory with the filename.
/// Automatically appends `.mp4` extension if not already present.
/// Applies title replacement rules from settings to sanitize the filename.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing settings
/// * `filename` - Desired output filename (with or without extension)
///
/// # Returns
///
/// Returns the full output path on success.
///
/// # Errors
///
/// Returns an error if:
/// - Settings cannot be retrieved
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
/// Used to estimate file size before download for disk space validation.
/// Returns `None` on any failure (network error, missing header, etc.).
///
/// # Arguments
///
/// * `url` - URL to check
/// * `cookie` - Optional cookie header for authentication
///
/// # Returns
///
/// Returns `Some(content_length)` on success, or `None` on failure.
async fn head_content_length(url: &str, cookie: Option<&str>) -> Option<u64> {
    let client = build_client().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let response = req.send().await.ok()?;

    // Only accept successful responses (200 OK)
    if !response.status().is_success() {
        // HEAD request may fail (e.g., 403 Forbidden) but download continues normally
        // eprintln!("HEAD request failed for {}: {}", url, response.status());
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
/// Checks available disk space at the target location using `statvfs`.
/// Currently only implemented for Unix-like systems; no-op on other platforms.
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
/// Returns `ERR::DISK_FULL` if available space is less than required.
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
            #[allow(clippy::unnecessary_cast)]
            #[allow(clippy::useless_conversion)]
            let free_bytes = u64::from(stat.f_bavail) * stat.f_frsize;
            if free_bytes < needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Windows 等未実装 -> スキップ
    Ok(())
}

/// Retries a download operation up to 3 times with linear backoff.
///
/// Implements retry logic for transient network failures:
/// - Maximum 3 attempts
/// - Linear backoff: 500ms, 1000ms, 1500ms
/// - Only retries on specific keywords: "segment", "request error", "timeout", "connect"
///
/// # Arguments
///
/// * `f` - Async closure that performs the download operation
///
/// # Returns
///
/// Returns `Ok(())` on successful download.
///
/// # Errors
///
/// Returns an error if:
/// - All retry attempts fail
/// - Error is not retryable (doesn't match keywords)
/// - Error contains `ERR::` prefix (passed through as-is)
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    const MAX_ATTEMPTS: u8 = 3;
    const RETRYABLE_KEYWORDS: &[&str] = &["segment", "request error", "timeout", "connect"];

    for attempt in 1..=MAX_ATTEMPTS {
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                let is_retryable = RETRYABLE_KEYWORDS.iter().any(|&kw| msg.contains(kw));

                if attempt >= MAX_ATTEMPTS || !is_retryable {
                    return Err(if msg.contains("ERR::") {
                        msg
                    } else {
                        format!("ERR::NETWORK::{msg}")
                    });
                }

                tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
            }
        }
    }

    unreachable!()
}

/// Selects a stream URL from a quality list.
///
/// Searches for a stream matching the requested quality ID.
/// Selects a stream URL from a list of available qualities with fallback.
///
/// Attempts to find the requested quality in the list. If not found, falls back
/// to the highest quality (first item) which represents the best available quality.
///
/// # Arguments
///
/// * `items` - Slice of available video/audio streams with quality information
/// * `quality` - Requested quality ID (use -1 for best available)
///
/// # Returns
///
/// Returns a tuple of (primary_url, backup_urls, is_fallback) on success.
/// `is_fallback` is true if the requested quality was not found and
/// the first available quality was used instead.
///
/// # Errors
///
/// Returns `ERR::QUALITY_NOT_FOUND` if the quality list is empty.
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

/// Response structure for the watch history API.
///
/// Contains a list of history entries and pagination cursor.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
/// Response from Bilibili watch history API.
///
/// Contains paginated watch history entries with a cursor for fetching
/// subsequent pages.
///
/// # Fields
///
/// * `entries` - List of watch history entries with video metadata
/// * `cursor` - Pagination cursor for the next page request
pub struct WatchHistoryResponse {
    pub entries: Vec<WatchHistoryEntry>,
    pub cursor: WatchHistoryCursor,
}

/// Fetches watch history from Bilibili with pagination support.
///
/// Retrieves the user's viewing history from Bilibili's API using cursor-based
/// pagination. Requires valid authentication cookies.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `max` - Maximum number of entries to fetch (0 for default, typically 20)
/// * `view_at` - Timestamp cursor for pagination (0 for first page)
///
/// # Returns
///
/// Returns a `WatchHistoryResponse` containing:
/// - `entries`: List of watch history entries with video metadata
/// - `cursor`: Pagination cursor for fetching more entries
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable (`ERR::COOKIE_MISSING`)
/// - User is not logged in (`ERR::UNAUTHORIZED`)
/// - HTTP request fails
/// - Response parsing fails
///
/// # Pagination
///
/// Use the `cursor` from the response to fetch the next page:
/// ```rust
/// let first_page = fetch_watch_history(app, 0, 0).await?;
/// let next_page = fetch_watch_history(app, first_page.cursor.max, first_page.cursor.view_at).await?;
/// ```
pub async fn fetch_watch_history(
    app: &AppHandle,
    max: i32,
    view_at: i64,
) -> Result<WatchHistoryResponse, String> {
    // 1. Cookie取得（必須）
    let cookies = read_cookie(app)?.unwrap_or_default();

    if cookies.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }

    let cookie_header = build_cookie_header(&cookies);

    // 2. API呼び出し
    // 初回リクエストではパラメータを省略、2回目以降はmax/view_atを使用
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

    // 3. エラーハンドリング（-101: 未ログイン）
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

    // 4. DTO変換（サムネイルを並列でBase64エンコード）
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

/// Fetches available subtitles for a video part from the Player v2 API.
///
/// Uses WBI signature for authentication.
/// Returns an empty vector if no subtitles are available or on error.
pub async fn fetch_subtitles(
    client: &Client,
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Vec<SubtitleDto> {
    let cookie_header = build_cookie_header(cookies);
    let mixin_key = match crate::utils::wbi::fetch_mixin_key(
        client,
        if cookie_header.is_empty() {
            None
        } else {
            Some(&cookie_header)
        },
    )
    .await
    {
        Ok(key) => key,
        Err(_) => return Vec::new(),
    };

    let mut params = BTreeMap::from([
        ("bvid".to_string(), bvid.to_string()),
        ("cid".to_string(), cid.to_string()),
    ]);

    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key);

    let response = match client
        .get("https://api.bilibili.com/x/player/wbi/v2")
        .header(header::COOKIE, build_cookie_header(cookies))
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&[
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("w_rid", &signature.w_rid),
            ("wts", &signature.wts),
        ])
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Vec::new(),
    };

    if !response.status().is_success() {
        return Vec::new();
    }

    let body: PlayerV2ApiResponse = match response.json().await {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    if body.code != 0 {
        return Vec::new();
    }

    let subtitles = body
        .data
        .and_then(|d| d.subtitle)
        .and_then(|s| s.subtitles)
        .unwrap_or_default();

    subtitles
        .into_iter()
        .map(|item| {
            let is_ai = item.subtitle_url.contains("/ai_subtitle/");
            SubtitleDto {
                lan: item.lan,
                lan_doc: item.lan_doc,
                subtitle_url: item.subtitle_url,
                is_ai,
            }
        })
        .collect()
}

/// Fetches available subtitles for a specific video part.
///
/// Used for lazy-loading subtitles when the user opens the subtitle accordion
/// in the UI.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns a list of available subtitles with language info and URLs.
/// Returns an empty vector if no subtitles are available or on error.
pub async fn fetch_subtitles_for_part(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
) -> Result<Vec<SubtitleDto>, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let client = build_client()?;
    Ok(fetch_subtitles(&client, &cookies, bvid, cid).await)
}

/// Fetches available video and audio qualities for a specific part.
///
/// Used for lazy-loading qualities when the part is rendered in the UI
/// (virtual scrolling optimization).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns a tuple of (video_qualities, audio_qualities).
pub async fn fetch_part_qualities(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
) -> Result<(Vec<Quality>, Vec<Quality>), String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let details = fetch_video_details(&cookies, bvid, cid).await?;
    let data = details.data.ok_or("ERR::NO_STREAM")?;

    // DASH format: separate video and audio streams
    if let Some(dash) = data.dash {
        let video_qualities = convert_qualities(&dash.video);
        let audio_qualities = convert_qualities(&dash.audio);
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
                quality: if !f.new_description.is_empty() {
                    f.new_description.clone()
                } else if !f.display_desc.is_empty() {
                    f.display_desc.clone()
                } else if !f.description.is_empty() {
                    f.description.clone()
                } else {
                    quality_to_string(&f.quality)
                },
            })
            .collect();
        // durl format has no separate audio stream
        return Ok((video_qualities, vec![]));
    }

    Err("ERR::NO_STREAM".to_string())
}

/// Downloads a subtitle and saves it in SRT format.
///
/// Fetches a BCC-format JSON subtitle from Bilibili, converts it to SRT format,
/// and saves it to the specified output path.
///
/// # Arguments
///
/// * `client` - HTTP client for making the request
/// * `subtitle_url` - URL to the BCC subtitle JSON (may start with "//")
/// * `output_path` - Path where the SRT file will be saved
///
/// # Errors
///
/// Returns an error if:
/// - The download fails
/// - HTTP response is not successful
/// - JSON parsing fails
/// - File write fails
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

/// Prepares the subtitle merge mode based on user options.
///
/// Downloads selected subtitles and returns the appropriate merge mode for ffmpeg.
/// Converts BCC JSON subtitles to SRT format and stores them in temp files.
///
/// # Arguments
///
/// * `subtitle_opts` - User's subtitle selection (mode and languages)
/// * `cookies` - Cookie entries for authentication
/// * `bvid` - Bilibili video ID
/// * `cid` - Content ID for the specific video part
/// * `download_id` - Unique download identifier for temp file naming
/// * `lib_path` - Directory for temp subtitle files
///
/// # Returns
///
/// Returns a tuple of (MergeMode, language_labels) where:
/// - `MergeMode::None` if subtitles are disabled, no languages selected,
///   or no matching subtitles found
/// - `MergeMode::SoftSub` for soft-sub mode or `MergeMode::HardSub` for burn-in mode
/// - `language_labels` contains the display names (lan_doc) of selected subtitles
///
/// # Errors
///
/// Returns an error if HTTP client cannot be built.
async fn prepare_subtitle_mode(
    subtitle_opts: &Option<SubtitleOptions>,
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
    download_id: &str,
    lib_path: &Path,
) -> Result<(crate::handlers::ffmpeg::MergeMode, Vec<String>), String> {
    use crate::handlers::ffmpeg::{MergeMode, SubtitleMergeOptions};
    use crate::utils::subtitle::lan_to_iso639;

    let sub_opts = match subtitle_opts {
        Some(opts) if opts.mode != "off" && !opts.selected_lans.is_empty() => opts,
        _ => return Ok((MergeMode::None, vec![])),
    };

    let client = build_client()?;
    let available_subs = fetch_subtitles(&client, cookies, bvid, cid).await;

    let selected_subs: Vec<_> = available_subs
        .iter()
        .filter(|s| sub_opts.selected_lans.contains(&s.lan))
        .collect();

    if selected_subs.is_empty() {
        return Ok((MergeMode::None, vec![]));
    }

    let mut subtitle_files: Vec<SubtitleMergeOptions> = Vec::new();
    let mut language_labels: Vec<String> = Vec::new();
    for sub in selected_subs {
        let srt_path = lib_path.join(format!("temp_sub_{download_id}_{}.srt", sub.lan));

        if let Err(e) = download_subtitle(&client, &sub.subtitle_url, &srt_path).await {
            eprintln!("Warning: Failed to download subtitle {}: {}", sub.lan, e);
            continue;
        }

        subtitle_files.push(SubtitleMergeOptions {
            path: srt_path,
            language: lan_to_iso639(&sub.lan).to_string(),
            title: sub.lan_doc.clone(),
        });
        language_labels.push(sub.lan_doc.clone());
    }

    if subtitle_files.is_empty() {
        return Ok((MergeMode::None, vec![]));
    }

    let mode = match sub_opts.mode.as_str() {
        "hard" => subtitle_files
            .into_iter()
            .next()
            .map(MergeMode::HardSub)
            .unwrap_or(MergeMode::None),
        _ => MergeMode::SoftSub(subtitle_files),
    };
    Ok((mode, language_labels))
}

// ============================================================================
// Bangumi Handlers
// ============================================================================

/// Fetches bangumi metadata from Bilibili.
///
/// Retrieves bangumi season info, episode list, and basic information.
/// Quality options are fetched lazily via separate API calls.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `ep_id` - Bangumi episode ID (e.g., 3051843)
///
/// # Returns
///
/// Returns a `Video` struct with title, bvid, parts, and quality limitation flag.
///
/// # Errors
///
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

    // Error handling for bangumi-specific codes
    match body.code {
        -404 => return Err("ERR::BANGUMI_NOT_FOUND".into()),
        -403 => return Err("ERR::BANGUMI_ACCESS_DENIED".into()),
        -688 => return Err("ERR::BANGUMI_REGION_RESTRICTED".into()),
        -689 => return Err("ERR::BANGUMI_COPYRIGHT_RESTRICTED".into()),
        0 => {}
        _ => {
            return Err(format!(
                "ERR::API_ERROR (code {}): {}",
                body.code, body.message
            ))
        }
    }

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

    // Convert episodes to VideoParts
    let parts: Vec<VideoPart> = result
        .episodes
        .iter()
        .enumerate()
        .map(|(idx, ep)| VideoPart {
            cid: ep.cid,
            page: (idx + 1) as i32,
            part: if ep.long_title.is_empty() {
                ep.title.clone()
            } else {
                format!("{} {}", ep.title, ep.long_title).trim().to_string()
            },
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
        })
        .collect();

    Ok(Video {
        title: result.title.clone(),
        bvid: format!("av{}", target_ep.aid), // Use AID as identifier
        parts,
        is_limited_quality,
        content_type: "bangumi".to_string(),
        ep_id: Some(ep_id),
        season_title: Some(result.title),
    })
}

/// Fetches bangumi player result for quality selection.
/// Returns raw player result that can contain either DASH or durl format.
///
/// # Arguments
///
/// * `cookies` - Cookie entries for authentication
/// * `ep_id` - Bangumi episode ID
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns the raw player result containing either DASH or durl stream data.
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

    match body.code {
        -403 => Err("ERR::BANGUMI_ACCESS_DENIED".into()),
        -688 => Err("ERR::BANGUMI_REGION_RESTRICTED".into()),
        -689 => Err("ERR::BANGUMI_COPYRIGHT_RESTRICTED".into()),
        0 => Ok(()),
        _ => Err(format!(
            "ERR::API_ERROR (code {}): {}",
            body.code, body.message
        )),
    }?;

    let result = body
        .result
        .ok_or_else(|| "ERR::API_ERROR No result field".to_string())?;

    let has_dash = result.dash.is_some();
    let has_durl = result.durls.is_some()
        && result
            .durls
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false);

    if !has_dash && !has_durl {
        return Err("ERR::BANGUMI_NO_DASH".into());
    }

    Ok(result)
}

/// Fetches bangumi stream URLs for download (DASH format only).
/// Returns XPlayerApiResponse for compatibility with existing download flow.
///
/// Note: This function only supports DASH format. For durl format (MP4),
/// the download_video function handles it separately.
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
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `ep_id` - Bangumi episode ID
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns a tuple of (video_qualities, audio_qualities, is_preview).
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
    let cookies = read_cookie(app)?.unwrap_or_default();
    let result = fetch_bangumi_player_result(&cookies, ep_id, cid).await?;

    let is_preview = result.is_preview.map(|v| v == 1);

    // Try DASH format first
    if let Some(dash) = &result.dash {
        let video_qualities = convert_qualities(&dash.video);
        let audio_qualities = convert_qualities(&dash.audio);
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
