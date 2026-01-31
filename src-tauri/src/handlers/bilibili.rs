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
//! ## Parallel Download Implementation
//!
//! This module reduces download time by simultaneously downloading audio and video streams.
//! A semaphore (`VIDEO_SEMAPHORE`) limits concurrent operations to protect system resources.

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
/// Returns `Ok(())` on successful download and merge.
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
pub async fn download_video(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    filename: &str,
    quality: i32,
    audio_quality: i32,
    download_id: String,
    _parent_id: Option<String>,
) -> Result<(), String> {
    // Analytics: mark start
    // NOTE: GA4 Analytics は無効化されています
    // crate::utils::analytics::mark_download_start(&download_id);
    // --------------------------------------------------
    // 1. 出力ファイルパス決定 + 自動リネーム
    // --------------------------------------------------
    let mut output_path = match get_output_path(app, filename).await {
        Ok(p) => p,
        Err(e) => {
            // NOTE: GA4 Analytics は無効化されています
            // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e.to_string())).await;
            return Err(e.to_string());
        }
    };

    // Avoid double extension if user already provided .mp4
    let filename_with_ext = if filename.to_lowercase().ends_with(".mp4") {
        filename
    } else {
        &format!("{filename}.mp4")
    };

    // Get directory from output_path and construct final path
    if let Some(parent) = output_path.parent() {
        output_path = parent.join(filename_with_ext);
    } else {
        output_path = PathBuf::from(filename_with_ext);
    }
    output_path = auto_rename(&output_path);

    // --------------------------------------------------
    // 2. Cookie チェック
    // --------------------------------------------------
    let cookies_opt = match read_cookie(app) {
        Ok(c) => c,
        Err(e) => {
            // NOTE: GA4 Analytics は無効化されています
            // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e.to_string())).await;
            return Err(e.to_string());
        }
    };
    if cookies_opt.is_none() {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::COOKIE_MISSING")).await;
        return Err("ERR::COOKIE_MISSING".into());
    }
    let cookies = cookies_opt.unwrap();
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::COOKIE_MISSING")).await;
        return Err("ERR::COOKIE_MISSING".into());
    }

    // --------------------------------------------------
    // 2.5. 設定から速度閾値を取得
    // --------------------------------------------------
    let min_speed_threshold = settings::get_settings(app)
        .await
        .map_err(|e| e.to_string())?
        .download_speed_threshold_mbps;

    // --------------------------------------------------
    // 3. 動画詳細取得 (選択品質のURL抽出)
    // --------------------------------------------------
    let details = fetch_video_details(&cookies, bvid, cid).await?;

    // 選択品質が存在しなければフォールバック (先頭 = 最も高品質)
    let video_url = select_stream_url(&details.data.dash.video, quality)?;
    let audio_url = select_stream_url(&details.data.dash.audio, audio_quality)?;

    // --------------------------------------------------
    // 4. 容量事前チェック (取得できなければスキップ)
    // --------------------------------------------------
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 余裕 5MB
        ensure_free_space(&output_path, total_needed)?;
    }

    // --------------------------------------------------
    // 5. temp ファイルパス生成 (download_id ベース)
    // --------------------------------------------------
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", download_id));

    // --------------------------------------------------
    // 6. 並列ダウンロード (音声 + 動画)
    // --------------------------------------------------
    //
    // 同時実行制御:
    // - セマフォ (VIDEO_SEMAPHORE) を使用して、同時にダウンロード・マージ処理を実行できる数を制限
    // - セマフォはマージ完了まで保持されるため、並列実行数は「ネットワーク帯域」ではなく「マージ処理の負荷」に基づく
    //
    // 並列実行の利点:
    // - 音声と動画を同時にダウンロードすることで、ネットワーク帯域を有効活用
    // - ダウンロード時間を短縮（逐次実行の場合と比較して最大50%削減可能）
    //
    // エラーハンドリング:
    // - tokio::try_join! により、いずれかのダウンロードが失敗した時点で即座にキャンセル
    // - retry_download によりネットワーク一時エラーの場合は自動再試行（最大3回）
    //
    // セマフォのライフサイクル:
    // 1. acquire_owned() - ダウンロード開始前に取得
    // 2. 並列ダウンロード実行
    // 3. マージ実行
    // 4. drop(permit) - マージ完了後に解放
    //
    // セマフォをマージ完了まで保持
    let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

    let cookie = Some(cookie_header.clone());

    // 並列実行（片方失敗で即時キャンセル）
    if let Err(e) = tokio::try_join!(
        retry_download(|| {
            download_url(
                app,
                audio_url.clone(),
                temp_audio_path.clone(),
                cookie.clone(),
                true,
                Some(download_id.clone()),
                Some(min_speed_threshold),
            )
        }),
        retry_download(|| {
            download_url(
                app,
                video_url.clone(),
                temp_video_path.clone(),
                cookie.clone(),
                true,
                Some(download_id.clone()),
                Some(min_speed_threshold),
            )
        }),
    ) {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e)).await;
        return Err(e);
    }

    // --------------------------------------------------
    // 7. マージ (merge stage emit)
    // --------------------------------------------------
    // merge stage は ffmpeg::merge_av 内で Emits を1つ生成して送信する (重複防止)
    if let Err(_e) = merge_av(
        app,
        &temp_video_path,
        &temp_audio_path,
        &output_path,
        Some(download_id.clone()),
    )
    .await
    {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::MERGE_FAILED")).await;
        return Err("ERR::MERGE_FAILED".into());
    }

    // マージ完了後にセマフォを解放
    // これにより、他の待機中のダウンロードがセマフォを取得可能になる
    drop(permit);

    // temp 削除
    let _ = tokio::fs::remove_file(&temp_video_path).await;
    let _ = tokio::fs::remove_file(&temp_audio_path).await;

    // 履歴に保存 (非同期で失敗してもダウンロードには影響しない)
    let app_clone = app.clone();
    let bvid_clone = bvid.to_string();
    let quality_clone = quality;
    tokio::spawn(async move {
        match save_to_history(
            &app_clone,
            &bvid_clone,
            quality_clone,
            video_size,
            audio_size,
        )
        .await
        {
            Ok(_) => {
                eprintln!("History entry saved successfully: {}", bvid_clone);
            }
            Err(e) => {
                // 履歴保存失敗は致命的ではない（ダウンロード自体は成功している）
                eprintln!(
                    "Warning: Failed to save to history for {}: {}",
                    bvid_clone, e
                );
                // TODO: フロントエンドに通知する場合、ここでイベントを発行
            }
        }
    });

    // 完了イベントは ffmpeg::merge_av 内で stage=complete + complete() を送信する
    // NOTE: GA4 Analytics は無効化されています
    // crate::utils::analytics::finish_download(app, &download_id, true, None).await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
/// * `video_size` - Video file size in bytes
/// * `audio_size` - Audio file size in bytes
async fn save_to_history(
    app: &AppHandle,
    bvid: &str,
    quality: i32,
    video_size: Option<u64>,
    audio_size: Option<u64>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::models::history::HistoryEntry;
    use crate::store::HistoryStore;
    use chrono::Utc;
    use std::time::{SystemTime, UNIX_EPOCH};

    // 動画タイトルを取得
    let title =
        match fetch_video_title_for_history(bvid, read_cookie(app)?.as_deref().unwrap_or_default())
            .await
        {
            Some(t) => t,
            None => bvid.to_string(), // フォールバック: BV IDを使用
        };

    let id = format!(
        "{}_{}",
        bvid,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let downloaded_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let file_size = video_size.and_then(|vs| audio_size.map(|asz| vs + asz));

    let entry = HistoryEntry {
        id: id.clone(),
        title,
        url: format!("https://www.bilibili.com/video/{}", bvid),
        downloaded_at,
        status: "completed".to_string(),
        file_size,
        quality: Some(quality_to_string(&quality)),
        thumbnail_url: None,
        version: "1.0".to_string(),
    };

    let store = HistoryStore::new(app)?;
    store.add_entry(entry)?;

    eprintln!("History entry saved: {}", id);
    Ok(())
}

/// Converts quality ID to human-readable string representation.
///
/// Maps Bilibili API quality IDs to readable format strings.
///
/// # Arguments
///
/// * `quality` - Quality ID from Bilibili API
///
/// # Returns
///
/// Human-readable quality string (e.g., "1080P60")
fn quality_to_string(quality: &i32) -> String {
    match quality {
        116 => "4K".to_string(),
        112 => "1080P60".to_string(),
        80 => "1080P".to_string(),
        64 => "720P".to_string(),
        32 => "480P".to_string(),
        16 => "360P".to_string(),
        _ => format!("Q{}", quality),
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
/// `Some(title)` if successful, `None` if fetch fails.
async fn fetch_video_title_for_history(bvid: &str, cookies: &[CookieEntry]) -> Option<String> {
    let video = crate::models::frontend_dto::Video {
        title: String::new(),
        bvid: bvid.to_string(),
        parts: Vec::new(),
    };

    match fetch_video_title(&video, cookies).await {
        Ok(body) => Some(body.data.title),
        Err(_) => None,
    }
}

/// Fetches logged-in user information from Bilibili.
///
/// Retrieves user profile data using cached cookies from Firefox.
/// Returns `None` instead of an error when no valid cookies are available.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
///
/// # Returns
///
/// `Ok(Some(User))` if user info was successfully retrieved,
/// `Ok(None)` if no valid cookies are available.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - Response JSON parsing fails
pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    // 1) メモリキャッシュから Cookie を取得
    let Some(cookies) = read_cookie(app)? else {
        return Ok(None);
    };

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        return Ok(None);
    }

    // 3) リクエスト送信（Cookie ヘッダを付与）
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;

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

    Ok(Some(User {
        code: body.code,
        message: body.message,
        data: UserData {
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
    }))
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
/// Base64-encoded image data.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - Response byte reading fails
async fn base64_encode(url: &str) -> Result<String, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch thumbnail image: {}", e))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read thumbnail image bytes: {}", e))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(encoded)
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
    let Some(cookies) = read_cookie(app)? else {
        return Err("No cookies found".into());
    };

    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: Vec::new(),
    };

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    video.title = res_body_1.data.title;

    for page in res_body_1.data.pages.iter() {
        let thumb_url = page.first_frame.clone();
        let thumb_base64 = base64_encode(&thumb_url).await.unwrap_or_default();

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

        // partごとに画質情報を取得
        let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
        part.video_qualities = convert_qualities(&res_body_2.data.dash.video);
        part.audio_qualities = convert_qualities(&res_body_2.data.dash.audio);

        video.parts.push(part);
    }

    Ok(video)
}

/// Converts API video/audio quality data to frontend DTO format.
///
/// Groups quality options by ID, selects the highest codec for each quality level,
/// and returns them sorted in descending order (highest quality first).
///
/// # Algorithm
///
/// 1. Group by quality ID (`id`) using `BTreeMap`
/// 2. Select item with maximum `codecid` within each group
/// 3. Store in vector sorted by quality ID descending
///
/// # Arguments
///
/// * `video` - Slice of video/audio quality options from API
///
/// # Returns
///
/// Vector of `Quality` objects sorted by quality ID in descending order.
fn convert_qualities(video: &[XPlayerApiResponseVideo]) -> Vec<Quality> {
    let mut res = Vec::<Quality>::new();

    // id(= quality)毎でグルーピングして、 各アイテムの`codecid`が一番大きいものを選択
    // BTreeMapはキー(id)を常に昇順ソートする
    let mut id_groups: BTreeMap<i32, Vec<XPlayerApiResponseVideo>> = BTreeMap::new();
    for item in video {
        id_groups.entry(item.id).or_default().push(item.clone())
    }

    // id毎に最大の codecid を選択
    let mut qualities = BTreeMap::new();
    for (id, items) in id_groups {
        if let Some(max_item) = items.into_iter().max_by_key(|it| it.codecid) {
            qualities.insert(id, max_item);
        }
    }
    // id値の降順で配列格納
    for item in qualities.iter().rev() {
        res.push(Quality {
            id: *item.0,
            codecid: item.1.codecid,
        });
    }

    res
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
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;

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

    let text = res
        .text()
        .await
        .map_err(|e| format!("WebInterface Api Failed to read response text: {e}"))?;

    let body: WebInterfaceApiResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("WebInterfaceApi error: {}", body.message));
    }

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
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("XPlayerApi failed to build client: {e}"))?;

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
            ("voice_balance", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;

    let body: XPlayerApiResponse = res
        .json::<XPlayerApiResponse>()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("XPlayerApi error: {}", body.message));
    }

    Ok(body)
}

/// Constructs the full output path for the downloaded file.
///
/// Reads the download output directory from application settings and
/// appends the filename to it.
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
async fn get_output_path(app: &AppHandle, filename: &str) -> anyhow::Result<PathBuf> {
    let settings = settings::get_settings(app)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get settings: {}", e))?;
    let output_path = settings
        .dl_output_path
        .ok_or_else(|| anyhow::anyhow!("Download output path is not configured"))?;
    let dir = PathBuf::from(&output_path);
    Ok(dir.join(filename))
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

/// Gets Content-Length of a resource via HEAD request.
///
/// Sends HEAD request to check file size before download.
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
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    req.send()
        .await
        .ok()?
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
            let free_bytes = (stat.f_bavail as u64) * stat.f_frsize;
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
                // ネットワーク/一時的エラーのみ再試行
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

    unreachable!()
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
fn select_stream_url(
    items: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    quality: i32,
) -> Result<String, String> {
    items
        .iter()
        .find(|v| v.id == quality)
        .map(|v| v.base_url.clone())
        .or_else(|| items.first().map(|fb| fb.base_url.clone()))
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into())
}
