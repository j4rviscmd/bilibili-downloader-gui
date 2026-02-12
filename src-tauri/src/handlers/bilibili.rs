//! Bilibili API Integration Module
//!
//! This module handles all interactions with the Bilibili API:
//!
//! ## Main Features
//!
//! - **Video Info Retrieval**: Fetches video metadata including title, quality options, thumbnails
//! - **User Authentication**: Retrieves user info using cached cookies from Firefox
//! - **Video Download**: Parallel audio/video stream downloads merged via ffmpeg
//!

use serde::Deserialize;

/// Download options for video download command.
///
/// Groups all parameters needed for downloading a video part into a single struct
/// to avoid excessive function arguments.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    /// Bilibili video ID (BV identifier)
    pub bvid: String,
    /// Content ID for the specific video part
    pub cid: i64,
    /// Output filename (extension optional; .mp4 added if not present)
    pub filename: String,
    /// Video quality ID (falls back to highest quality if unavailable)
    pub quality: i32,
    /// Audio quality ID (falls back to highest quality if unavailable)
    pub audio_quality: i32,
    /// Unique identifier for tracking this download
    pub download_id: String,
    /// Parent download ID for multi-part videos (optional)
    pub parent_id: Option<String>,
    /// Video duration in seconds for accurate merge progress
    pub duration_seconds: i64,
    /// Thumbnail URL for this part (optional)
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    /// Page number for multi-part videos (optional)
    #[serde(default)]
    pub page: Option<i32>,
}

use crate::constants::REFERER;
use crate::handlers::cookie::read_cookie;
use crate::handlers::ffmpeg::merge_av;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    UserApiResponse, WebInterfaceApiResponse, XPlayerApiResponse, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{Quality, Thumbnail, UserData, Video, VideoPart};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use base64::Engine;
use reqwest::{
    header::{self},
    Client,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Builds a reqwest HTTP client with default user agent.
///
/// # Returns
///
/// Configured HTTP client.
///
/// # Errors
///
/// Returns an error if client builder fails.
fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))
}

/// Validates Bilibili API response.
///
/// # Arguments
///
/// * `code` - API response code (0 = success)
/// * `message` - API response message
/// * `data` - Optional data field reference
///
/// # Returns
///
/// `Ok(())` if response is valid.
///
/// # Errors
///
/// Returns an error if:
/// - Response code is non-zero
/// - Data field is None
/// - Video not found (code -404)
/// - Request error (code -400)
fn validate_api_response<T>(code: i64, _message: &str, data: Option<&T>) -> Result<(), String> {
    // Video not found (-404: "啥都木有" = nothing there)
    if code == -404 {
        return Err("ERR::VIDEO_NOT_FOUND".to_string());
    }
    // Request error (-400: "请求错误" = request error)
    if code == -400 {
        return Err("ERR::API_ERROR".to_string());
    }
    if code != 0 {
        // Return generic error code instead of raw API message (may be in Chinese)
        return Err("ERR::API_ERROR".to_string());
    }
    if data.is_none() {
        return Err("ERR::API_ERROR".to_string());
    }
    Ok(())
}

/// Downloads a Bilibili video with the specified quality settings.
///
/// This function orchestrates the entire download process:
/// 1. Determines output path and auto-rename handling
/// 2. Validates cookie presence
/// 3. Fetches video details and stream URLs
/// 4. Pre-checks disk space
/// 5. Parallel audio/video stream downloads with retry logic
/// 6. Merges streams via ffmpeg
///
/// Progress updates are emitted to the frontend throughout the process.
///
/// # Parallel Download Strategy
///
/// Audio and video streams are downloaded simultaneously to reduce total download time.
/// A semaphore (`VIDEO_SEMAPHORE`) limits concurrency to protect system resources.
///
/// ## Semaphore Lifecycle
///
/// 1. **Acquire**: `acquire_owned()` before download starts
/// 2. **Parallel Download**: Audio and video download simultaneously
/// 3. **Merge**: ffmpeg combines audio and video
/// 4. **Release**: `drop(permit)` after merge completes
///
/// This design limits concurrency based on "merge load" rather than network bandwidth.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
/// * `filename` - Output filename (extension optional; .mp4 added if not present)
/// * `quality` - Video quality ID (falls back to highest quality if unavailable)
/// * `audio_quality` - Audio quality ID (falls back to highest quality if unavailable)
/// * `download_id` - Unique identifier for tracking this download
/// * `_parent_id` - Parent download ID for multi-part videos (currently unused)
///
/// # Returns
///
/// Returns the output file path as `String` on successful download and merge.
///
/// # Errors
///
/// Returns an error if:
/// - Settings or output path cannot be retrieved
/// - Cookie is missing (`ERR::COOKIE_MISSING`)
/// - Selected quality is unavailable (`ERR::QUALITY_NOT_FOUND`)
/// - Disk space is insufficient (`ERR::DISK_FULL`)
/// - Download fails after retry attempts (`ERR::NETWORK`)
/// - ffmpeg merge fails (`ERR::MERGE_FAILED`)
pub async fn download_video(app: &AppHandle, options: &DownloadOptions) -> Result<String, String> {
    // 1. 出力ファイルパス決定 + 自動リネーム
    let output_path = auto_rename(&build_output_path(app, &options.filename).await?);

    // 2. Cookie取得（WBI署名により非ログインユーザでも動作）
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    // Cookieヘッダーが空でも続行（WBI署名により画質制限付きでダウンロード可能）

    // 3. 動画詳細取得 (選択品質のURL抽出)
    let details = fetch_video_details(&cookies, &options.bvid, options.cid).await?;

    let dash_data = details
        .data
        .ok_or_else(|| {
            format!(
                "XPlayerApi error (code {}): {} - no data field",
                details.code, details.message
            )
        })?
        .dash;

    // 選択品質が存在しなければフォールバック (先頭 = 最も高品質)
    let video_url = select_stream_url(&dash_data.video, options.quality)?;
    let audio_url = select_stream_url(&dash_data.audio, options.audio_quality)?;

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
                temp_audio_path.clone(),
                cookie.clone(),
                true,
                Some(options.download_id.clone()),
            )
        }),
        retry_download(|| {
            download_url(
                app,
                video_url.clone(),
                temp_video_path.clone(),
                cookie.clone(),
                true,
                Some(options.download_id.clone()),
            )
        }),
    )?;

    // マージ実行 (merge stage emitはffmpeg::merge_av内で送信)
    merge_av(
        app,
        &temp_video_path,
        &temp_audio_path,
        &output_path,
        Some(options.download_id.clone()),
        Some((options.duration_seconds * 1000) as u64), // Convert seconds to milliseconds
    )
    .await
    .map_err(|_| String::from("ERR::MERGE_FAILED"))?;

    // マージ完了後にセマフォを解放
    drop(permit);

    // temp 削除
    let _ = tokio::fs::remove_file(&temp_video_path).await;
    let _ = tokio::fs::remove_file(&temp_audio_path).await;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Tests conversion of quality IDs to human-readable strings.
    ///
    /// Verifies that known quality IDs produce the expected display names
    /// and unknown IDs fall back to the "Q{id}" format.
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

/// Saves download history entry after successful download completion.
///
/// Creates and persists a history entry with metadata fetched from the API.
/// Falls back to using the BV ID as title if API fetch fails.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `bvid` - Bilibili video ID
/// * `quality` - Video quality ID
/// * `file_size` - Actual merged file size in bytes
/// * `filename` - User-specified filename (without extension)
/// * `thumbnail_url` - Optional thumbnail URL for this part
/// * `page` - Optional page number for multi-part videos
async fn save_to_history(
    app: &AppHandle,
    bvid: &str,
    quality: i32,
    file_size: Option<u64>,
    filename: &str,
    thumbnail_url: Option<String>,
    page: Option<i32>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::models::history::HistoryEntry;
    use crate::store::HistoryStore;
    use chrono::Utc;
    use std::time::{SystemTime, UNIX_EPOCH};

    // ユーザーが指定したファイル名から拡張子を削除してタイトルとして使用
    let title = filename.rsplit('.').next().unwrap_or(filename).to_string();

    // 渡されたサムネイルURLを使用、なければAPIで取得
    let thumbnail_url = if thumbnail_url.is_some() {
        thumbnail_url
    } else {
        fetch_video_info_for_history(bvid, read_cookie(app)?.as_deref().unwrap_or_default())
            .await
            .and_then(|(_, url)| url)
    };

    // pageパラメータを含めたURLを生成
    let url = format!(
        "https://www.bilibili.com/video/{}{}",
        bvid,
        page.map_or(String::new(), |p| format!("?p={p}"))
    );

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let id = format!("{}_{}", bvid, timestamp_ms);
    let downloaded_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let store = HistoryStore::new(app)?;
    store.add_entry(HistoryEntry {
        id: id.clone(),
        title,
        url,
        downloaded_at,
        status: "completed".to_string(),
        file_size,
        quality: Some(quality_to_string(&quality)),
        thumbnail_url,
        version: "1.0".to_string(),
    })?;

    eprintln!("History entry saved: {}", id);
    Ok(())
}

/// Converts quality ID to human-readable string representation.
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

/// Fetches video title for history entry (returns None on failure).
///
/// Attempts to retrieve the video title from Bilibili API.
/// Used internally when creating history entries.
///
/// # Arguments
///
/// * `bvid` - Bilibili video ID
/// * `cookies` - Authentication cookies
///
/// # Returns
///
/// Returns `(title, thumbnail_url)` if successful, `None` if fetch fails.
async fn fetch_video_info_for_history(
    bvid: &str,
    cookies: &[CookieEntry],
) -> Option<(String, Option<String>)> {
    let video = crate::models::frontend_dto::Video {
        title: String::new(),
        bvid: bvid.to_string(),
        parts: Vec::new(),
        is_limited_quality: false, // 履歴用では使用しない
    };

    fetch_video_title(&video, cookies)
        .await
        .ok()
        .and_then(|body| {
            let data = body.data?;
            let thumbnail_url = if data.pic.is_empty() {
                None
            } else {
                Some(data.pic)
            };
            Some((data.title, thumbnail_url))
        })
}

/// Fetches logged-in user information from Bilibili.
///
/// Retrieves user profile data using cached cookies from Firefox.
/// Always returns a User object with `has_cookie` indicating cookie status.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
///
/// # Returns
///
/// `Ok(User)` with `has_cookie` set based on cookie availability.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails (when cookies are available)
/// - Response JSON parsing fails (when cookies are available)
pub async fn fetch_user_info(app: &AppHandle) -> Result<User, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let has_cookie = !cookie_header.is_empty();

    if !has_cookie {
        return Ok(User {
            code: 0,
            message: String::new(),
            data: UserData {
                uname: None,
                is_login: false,
            },
            has_cookie: false,
        });
    }

    let client = build_client()?;
    let body = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;

    Ok(User {
        code: body.code,
        message: body.message,
        data: UserData {
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
        has_cookie: true,
    })
}

/// Builds Cookie header string from cookie entries.
///
/// Filters cookies for bilibili.com domain and formats them
/// as "name=value; name=value".
///
/// # Arguments
///
/// * `cookies` - Slice of cookie entries
///
/// # Returns
///
/// Formatted cookie header string ready for HTTP requests.
///
/// # Implementation Details
///
/// - Only includes cookies where host ends with "bilibili.com"
/// - Joins entries with semicolon and space separator
fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    cookies
        .iter()
        .filter(|c| c.host.ends_with("bilibili.com"))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Fetches image from URL and Base64 encodes it.
///
/// Downloads video thumbnails and Base64 encodes them for embedding
/// in the frontend without additional HTTP requests.
///
/// # Arguments
///
/// * `url` - Image URL to fetch
///
/// # Returns
///
/// Base64-encoded image data with data URI prefix.
///
/// # Errors
///
/// Returns an error if HTTP request fails or response reading fails.
pub async fn get_thumbnail_base64(url: &str) -> Result<String, String> {
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch thumbnail image: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read thumbnail image bytes: {e}"))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

/// Fetches comprehensive video metadata from Bilibili.
///
/// Retrieves:
/// - Video title
/// - All video parts (for multi-part videos)
/// - Available video/audio quality options
/// - Thumbnails (Base64-encoded images)
/// - Duration and other metadata
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `id` - Bilibili video ID (BV identifier)
///
/// # Returns
///
/// `Video` struct containing all metadata and available quality options.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable
/// - API request fails
/// - Response parsing fails
pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    // Cookie取得（WBI署名により非ログインユーザでも動作）
    let cookies = read_cookie(app)?.unwrap_or_default();

    // 画質制限の判定（Cookieがない場合は制限付き）
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: Vec::new(),
        is_limited_quality,
    };

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    // fetch_video_title 内で validate_api_response により data の存在が保証されている
    let data_1 = res_body_1.data.as_ref().unwrap();

    video.title = data_1.title.clone();

    let empty_pages = vec![];
    let pages = data_1.pages.as_ref().unwrap_or(&empty_pages);

    if pages.is_empty() {
        let mut part = VideoPart {
            cid: data_1.cid,
            page: 1,
            part: video.title.clone(),
            duration: 0,
            thumbnail: Thumbnail {
                url: data_1.pic.clone(),
                base64: get_thumbnail_base64(&data_1.pic).await.unwrap_or_default(),
            },
            video_qualities: Vec::new(),
            audio_qualities: Vec::new(),
        };

        let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
        let data_2 = res_body_2.data.as_ref().unwrap();

        part.video_qualities = convert_qualities(&data_2.dash.video);
        part.audio_qualities = convert_qualities(&data_2.dash.audio);

        video.parts.push(part);
    } else {
        for page in pages.iter() {
            let thumb_url = page.first_frame.clone().unwrap_or_default();
            let thumb_base64 = if thumb_url.is_empty() {
                String::new()
            } else {
                get_thumbnail_base64(&thumb_url).await.unwrap_or_default()
            };

            let mut part = VideoPart {
                cid: page.cid,
                page: page.page,
                part: page.part.clone(),
                duration: page.duration,
                thumbnail: Thumbnail {
                    url: thumb_url,
                    base64: thumb_base64,
                },
                video_qualities: Vec::new(),
                audio_qualities: Vec::new(),
            };

            let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
            let data_2 = res_body_2.data.as_ref().unwrap();

            part.video_qualities = convert_qualities(&data_2.dash.video);
            part.audio_qualities = convert_qualities(&data_2.dash.audio);

            video.parts.push(part);
        }
    }

    Ok(video)
}

/// Converts API video/audio quality data to frontend DTO format.
///
/// Groups quality options by ID, selects the highest codec for each quality level,
/// and returns them sorted in descending order (highest quality first).
///
/// # Arguments
///
/// * `video` - Slice of video/audio quality options from API
///
/// # Returns
///
/// Vector of `Quality` objects sorted by quality ID in descending order.
///
/// # Examples
///
/// ```
/// # use crate::models::bilibili_api::XPlayerApiResponseVideo;
/// # use crate::handlers::bilibili::convert_qualities;
/// # use crate::models::frontend_dto::Quality;
/// // Given API response with multiple codec options per quality:
/// // - Quality 80: codecs 7 (AVC) and 12 (HEVC)
/// // - Quality 64: codec 7 (AVC)
/// // The function selects the highest codec (12 > 7) for each quality
/// let api_qualities = vec![
///     XPlayerApiResponseVideo { id: 80, codecid: 7, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
///     XPlayerApiResponseVideo { id: 80, codecid: 12, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
///     XPlayerApiResponseVideo { id: 64, codecid: 7, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
/// ];
/// let result = convert_qualities(&api_qualities);
/// // Returns qualities sorted: [80 (codec 12), 64 (codec 7)]
/// assert_eq!(result[0].id, 80);
/// assert_eq!(result[0].codecid, 12); // Highest codec selected
/// assert_eq!(result[1].id, 64);
/// ```
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
        })
        .collect()
}

/// Fetches video title and page info from Bilibili Web Interface API.
///
/// Calls the `/x/web-interface/view` endpoint to retrieve basic metadata
/// including title and multi-part video page information.
///
/// # Arguments
///
/// * `video` - Video object containing BVID
/// * `cookies` - Bilibili authentication cookies
///
/// # Returns
///
/// API response containing video title and page details.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - JSON parsing fails
/// - API returns non-zero error code
async fn fetch_video_title(
    video: &Video,
    cookies: &[CookieEntry],
) -> Result<WebInterfaceApiResponse, String> {
    let client = build_client()?;

    let cookie_header = build_cookie_header(cookies);
    let res: reqwest::Response = client
        .get(format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            video.bvid
        ))
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("WebInterface Api Failed to fetch video info: {e}"))?;

    let body: WebInterfaceApiResponse = res
        .json()
        .await
        .map_err(|e| format!("WebInterface Api Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, &body.message, body.data.as_ref())?;
    Ok(body)
}

/// Fetches video stream URLs and quality options from Bilibili Player API.
///
/// Calls the `/x/player/wbi/playurl` endpoint to retrieve available
/// qualities and direct download URLs for DASH video/audio streams.
///
/// # Arguments
///
/// * `cookies` - Bilibili authentication cookies
/// * `bvid` - Video BVID identifier
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// API response containing DASH video/audio streams and quality options.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - JSON parsing fails
/// - API returns non-zero error code
async fn fetch_video_details(
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    let client = build_client()?;

    // WBI署名のためMixinKeyを取得
    let mixin_key = crate::utils::wbi::fetch_mixin_key(&client).await?;

    // クエリパラメータ構築
    let mut params = std::collections::BTreeMap::new();
    params.insert("bvid".to_string(), bvid.to_string());
    params.insert("cid".to_string(), cid.to_string());
    params.insert("qn".to_string(), "116".to_string());
    params.insert("fnval".to_string(), "2064".to_string());
    params.insert("fnver".to_string(), "0".to_string());
    params.insert("fourk".to_string(), "1".to_string());

    // WBI署名生成
    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key)?;

    // Cookieヘッダー構築（空でもOK）
    let cookie_header = build_cookie_header(cookies);

    let res: reqwest::Response = client
        .get("https://api.bilibili.com/x/player/wbi/playurl")
        .header(header::COOKIE, cookie_header)
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&[
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("qn", "116"),
            ("fnval", "2064"),
            ("fnver", "0"),
            ("fourk", "1"),
            ("w_rid", &signature.w_rid),
            ("wts", &signature.wts),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;

    let body: XPlayerApiResponse = res
        .json()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, &body.message, body.data.as_ref())?;
    Ok(body)
}

/// Automatically renames file if it already exists.
///
/// Appends a counter suffix (e.g., "filename (1).mp4") to avoid overwriting
/// existing files. Falls back to timestamp-based naming if 10,000+ duplicates exist.
///
/// # Arguments
///
/// * `path` - Original file path
///
/// # Returns
///
/// `PathBuf` that does not conflict with existing files.
///
/// # Implementation Details
///
/// - Returns original path if file does not exist
/// - Tries `(number)` suffix from 1 to 10,000
/// - Uses UNIX timestamp (milliseconds) if all duplicates exist
fn auto_rename(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
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

/// Builds the full output path for the downloaded file.
///
/// Reads the download output directory from application settings and
/// appends the filename to it. Ensures `.mp4` extension is present.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing settings
/// * `filename` - Desired filename (extension optional; .mp4 added if not present)
///
/// # Returns
///
/// Full path where the file should be saved.
///
/// # Errors
///
/// Returns an error if:
/// - Settings cannot be loaded
/// - Download path is not configured
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

/// Gets Content-Length of a resource via HEAD request.
///
/// Sends HEAD request to check file size before download.
/// This is a best-effort check used for disk space validation.
///
/// # Arguments
///
/// * `url` - URL to check
/// * `cookie` - Optional authentication cookie header
///
/// # Returns
///
/// `Some(size)` if Content-Length is available, `None` otherwise.
///
/// # Error Handling
///
/// Does not propagate errors; returns `None` on failure.
/// Network and parse errors are silently ignored.
/// Only returns Content-Length if HTTP status is 200 OK.
///
/// # Example
///
/// ```ignore
/// let size = head_content_length(&video_url, Some(&cookie_header)).await;
/// if let Some(bytes) = size {
///     println!("File size: {} bytes", bytes);
/// }
/// ```
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
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
/// Checks free space on target filesystem and returns error if insufficient.
/// Currently only implemented for Unix-like systems. Skipped on Windows and other platforms.
///
/// # Arguments
///
/// * `target_path` - File save destination path
/// * `needed_bytes` - Total bytes needed (including safety margin)
///
/// # Returns
///
/// `Ok(())` if sufficient space is available or check cannot be performed.
///
/// # Errors
///
/// Returns `ERR::DISK_FULL` error if free space is less than required bytes.
///
/// # Implementation Details
///
/// Uses `statvfs` system call on Unix-like systems to get free space.
/// Check is best-effort; continues without error if system call fails.
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
            if free_bytes <= needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Windows 等未実装 -> スキップ
    Ok(())
}

/// Retries download operation up to 3 times with linear backoff.
///
/// Wraps download operations and automatically retries on network-related errors
/// (timeouts, connection errors, etc.). Non-retryable errors are returned immediately.
///
/// Backoff strategy: 500ms, 1000ms, 1500ms
///
/// # Type Parameters
///
/// * `F` - Closure type that returns a Future
/// * `Fut` - Future type for the download operation
///
/// # Arguments
///
/// * `f` - Closure that returns a Future resolving to the download result
///
/// # Returns
///
/// `Ok(())` if download succeeds on any attempt.
///
/// # Errors
///
/// Returns an error if:
/// - All retry attempts fail
/// - Non-retryable error occurs (e.g., ERR::DISK_FULL)
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    const MAX_ATTEMPTS: u8 = 3;

    for attempt in 1..=MAX_ATTEMPTS {
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                let is_retryable = msg.contains("segment")
                    || msg.contains("request error")
                    || msg.contains("timeout")
                    || msg.contains("connect");

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

    // All attempts exhausted (covered by attempt >= MAX_ATTEMPTS above)
    Err("ERR::NETWORK::All retry attempts failed".to_string())
}

/// Selects stream URL from quality list.
///
/// Searches for URL matching requested quality. Falls back to first element
/// (highest quality) if not found. Returns error if quality list is empty.
///
/// # Arguments
///
/// * `items` - List of available quality options
/// * `quality` - Desired quality ID to select
///
/// # Returns
///
/// Selected stream URL.
///
/// # Errors
///
/// Returns `ERR::QUALITY_NOT_FOUND` error if quality list is empty.
///
/// # Example
///
/// ```ignore
/// let url = select_stream_url(&dash_data.video, 80)?; // Request 1080P
/// // Falls back to highest quality if 80 not available
/// ```
fn select_stream_url(
    items: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    quality: i32,
) -> Result<String, String> {
    items
        .iter()
        .find(|v| v.id == quality)
        .or_else(|| items.first())
        .map(|v| v.base_url.clone())
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into())
}
