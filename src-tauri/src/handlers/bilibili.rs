//! Bilibili API Integration
//!
//! This module handles all interactions with Bilibili's API, including
//! video information retrieval, user authentication, and video downloading.

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

/// Downloads a Bilibili video with specified quality settings.
///
/// This function orchestrates the complete download process:
/// 1. Determines output path and handles automatic renaming
/// 2. Validates cookie availability
/// 3. Fetches video details and stream URLs
/// 4. Checks available disk space
/// 5. Downloads audio and video streams separately (with retry logic)
/// 6. Merges streams using ffmpeg
///
/// Progress updates are emitted to the frontend throughout the process.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
/// * `filename` - Desired output filename (without extension)
/// * `quality` - Video quality ID (will fallback to highest if unavailable)
/// * `audio_quality` - Audio quality ID (will fallback to highest if unavailable)
/// * `download_id` - Unique identifier for progress tracking
/// * `_parent_id` - Optional parent ID for multi-part video tracking (currently unused)
///
/// # Returns
///
/// Returns `Ok(())` on successful download and merge.
///
/// # Errors
///
/// Returns an error if:
/// - Settings or output path cannot be determined
/// - Cookies are missing (`ERR::COOKIE_MISSING`)
/// - Selected quality is not available (`ERR::QUALITY_NOT_FOUND`)
/// - Disk space is insufficient (`ERR::DISK_FULL`)
/// - Download fails after retries (`ERR::NETWORK`)
/// - ffmpeg merge fails (`ERR::MERGE_FAILED`)
pub async fn download_video(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    filename: &str,
    quality: &i32,
    audio_quality: &i32,
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
    output_path.set_extension("mp4");
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

    // 選択動画品質が存在しなければフォールバック (先頭 = 最も高品質)
    let video_url = match details.data.dash.video.iter().find(|v| v.id == *quality) {
        Some(v) => v.base_url.clone(),
        None => match details.data.dash.video.first() {
            Some(fb) => {
                emit_stage(app, &download_id, "warn-video-quality-fallback");
                fb.base_url.clone()
            }
            None => {
                return Err("ERR::QUALITY_NOT_FOUND".into());
            }
        },
    };

    // 選択音声品質が存在しなければフォールバック (先頭 = 最も高品質)
    let audio_url = match details
        .data
        .dash
        .audio
        .iter()
        .find(|a| a.id == *audio_quality)
    {
        Some(a) => a.base_url.clone(),
        None => match details.data.dash.audio.first() {
            Some(fb) => {
                emit_stage(app, &download_id, "warn-audio-quality-fallback");
                fb.base_url.clone()
            }
            None => {
                return Err("ERR::QUALITY_NOT_FOUND".into());
            }
        },
    };

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
    // 6. ダウンロード (リトライ込み)
    // --------------------------------------------------
    // Audio → Video (セマフォ取得)
    let cookie_opt = Some(cookie_header.to_string());

    // Audio DL
    retry_download(|| {
        download_url(
            app,
            audio_url.clone(),
            temp_audio_path.clone(),
            cookie_opt.clone(),
            true,
            Some(download_id.clone()),
            Some(min_speed_threshold),
        )
    })
    .await?;

    // Video DL (セマフォ制御)
    let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;
    let video_res = retry_download(|| {
        download_url(
            app,
            video_url.clone(),
            temp_video_path.clone(),
            cookie_opt.clone(),
            true,
            Some(download_id.clone()),
            Some(min_speed_threshold),
        )
    })
    .await;
    if let Err(e) = video_res {
        drop(permit); // release permit
                      // NOTE: GA4 Analytics は無効化されています
                      // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e)).await;
        return Err(e);
    }
    // keep permit until merge 完了

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
        drop(permit);
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::MERGE_FAILED")).await;
        return Err("ERR::MERGE_FAILED".into());
    }
    drop(permit);

    // temp 削除
    let _ = tokio::fs::remove_file(&temp_video_path).await;
    let _ = tokio::fs::remove_file(&temp_audio_path).await;

    // 完了イベントは ffmpeg::merge_av 内で stage=complete + complete() を送信する
    // NOTE: GA4 Analytics は無効化されています
    // crate::utils::analytics::finish_download(app, &download_id, true, None).await;

    Ok(())
}

/// Fetches the currently logged-in user's information from Bilibili.
///
/// This function retrieves user profile data using cached cookies from Firefox.
/// If no valid cookies are available, it returns `None` without error.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns `Ok(Some(User))` if user info was successfully retrieved,
/// or `Ok(None)` if no cookies are available.
///
/// # Errors
///
/// Returns an error if:
/// - The HTTP request fails
/// - Response JSON parsing fails
pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    let mut result: Option<User> = None;

    // 1) メモリキャッシュから Cookie を取得
    let cookies = read_cookie(app)?;
    if cookies.is_none() {
        // DEBUG: println!("No cookies in cache");
        return Ok(result);
    }
    let cookies = cookies.unwrap();

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        // DEBUG: println!("No bilibili cookies found in cache");
        return Ok(result);
    }

    // 3) リクエスト送信（Cookie ヘッダを付与）
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;
    let res: reqwest::Response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;

    let body = res
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;
    // println!("Response body: {}", text);

    result = Some(User {
        code: body.code,
        message: body.message,
        data: UserData {
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
    });

    Ok(result)
}

/// Builds a Cookie header string from cookie entries.
///
/// Filters cookies to include only those for the bilibili.com domain
/// and formats them as "name=value; name=value".
///
/// # Arguments
///
/// * `cookies` - Slice of cookie entries
///
/// # Returns
///
/// Returns a formatted cookie header string suitable for HTTP requests.
fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    // bilibili ドメインのものに限定しつつ name=value; を組み立て
    let mut parts: Vec<String> = Vec::new();
    for c in cookies {
        if c.host.ends_with("bilibili.com") {
            // 値にセミコロンや改行が入らない前提。必要ならサニタイズ。
            parts.push(format!("{}={}", c.name, c.value));
        }
    }
    parts.join("; ")
}

/// Fetches an image from a URL and encodes it as Base64.
///
/// This function is used to download video thumbnails and encode them
/// for embedding in the frontend without additional HTTP requests.
///
/// # Arguments
///
/// * `url` - URL of the image to fetch
///
/// # Returns
///
/// Returns the Base64-encoded image data.
///
/// # Errors
///
/// Returns an error if:
/// - The HTTP request fails
/// - Reading response bytes fails
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

/// Fetches comprehensive metadata for a Bilibili video.
///
/// This function retrieves:
/// - Video title
/// - All video parts (for multi-part videos)
/// - Available quality options for video and audio
/// - Thumbnails (as Base64-encoded images)
/// - Duration and other metadata
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
/// * `id` - Bilibili video ID (BV identifier)
///
/// # Returns
///
/// Returns a `Video` structure containing all metadata and available quality options.
///
/// # Errors
///
/// Returns an error if:
/// - No cookies are available
/// - API requests fail
/// - Response parsing fails
pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    let video_parts = Vec::<VideoPart>::new();
    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: video_parts.clone(),
    };

    let cookies = read_cookie(app)?;
    if cookies.is_none() {
        return Err("No cookies found".into());
    }
    let cookies = cookies.unwrap();

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    video.title = res_body_1.data.title;
    for page in res_body_1.data.pages.iter() {
        let thumb_url = page.first_frame.clone();
        let thumb_base64 = base64_encode(&thumb_url).await.unwrap_or_default();

        let part = VideoPart {
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
        video.parts.push(part);
    }
    for part in video.parts.iter_mut() {
        // NOTE: partごとに画質情報を取得する必要がある？
        let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
        let video_qualities = convert_qualities(&res_body_2.data.dash.video);
        let audio_qualities = convert_qualities(&res_body_2.data.dash.audio);
        part.video_qualities = video_qualities;
        part.audio_qualities = audio_qualities;
    }

    Ok(video)
}

/// Converts API video/audio quality data to frontend DTO format.
///
/// This function groups quality options by ID, selects the highest codec
/// for each quality level, and returns them sorted in descending order
/// (highest quality first).
///
/// # Arguments
///
/// * `video` - Slice of video or audio quality options from the API
///
/// # Returns
///
/// Returns a vector of `Quality` objects sorted by quality ID (highest first).
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

/// Fetches video title and page information from Bilibili's Web Interface API.
///
/// This internal function calls the `/x/web-interface/view` endpoint to retrieve
/// basic video metadata including title and multi-part page information.
///
/// # Arguments
///
/// * `video` - Video object containing the BVID
/// * `cookies` - Bilibili authentication cookies
///
/// # Returns
///
/// Returns the API response containing video title and page details.
///
/// # Errors
///
/// Returns an error if the HTTP request fails, JSON parsing fails, or the
/// API returns a non-zero error code.
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

/// Fetches video stream URLs and quality options from Bilibili's Player API.
///
/// This internal function calls the `/x/player/wbi/playurl` endpoint to retrieve
/// available quality options and direct URLs for video and audio streams.
///
/// # Arguments
///
/// * `cookies` - Bilibili authentication cookies
/// * `vbid` - Video BVID identifier
/// * `cid` - Content ID for the specific video part
///
/// # Returns
///
/// Returns the API response containing DASH video/audio streams and quality options.
///
/// # Errors
///
/// Returns an error if the HTTP request fails, JSON parsing fails, or the
/// API returns a non-zero error code.
async fn fetch_video_details(
    cookies: &[CookieEntry],
    // video: &Video,
    vbid: &str,
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
            ("bvid", vbid),
            ("cid", cid.to_string().as_str()),
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

/// Constructs the full output path for a downloaded file.
///
/// Reads the download output directory from application settings and appends
/// the filename to it.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing settings
/// * `filename` - Desired filename (without extension)
///
/// # Returns
///
/// Returns the full path where the file should be saved.
///
/// # Errors
///
/// Returns an error if settings cannot be loaded or the download path is not configured.
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

/// Automatically renames a file if it already exists.
///
/// Appends a counter suffix (e.g., "filename (1).mp4") to avoid overwriting
/// existing files. If more than 10,000 duplicates exist, falls back to
/// timestamp-based naming.
///
/// # Arguments
///
/// * `path` - Original file path
///
/// # Returns
///
/// Returns a `PathBuf` that doesn't conflict with existing files.
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

/// Retrieves the Content-Length of a resource via HEAD request.
///
/// This function sends a HEAD request to determine the file size
/// before downloading.
///
/// # Arguments
///
/// * `url` - URL to query
/// * `cookie` - Optional cookie header for authentication
///
/// # Returns
///
/// Returns `Some(size)` if Content-Length is available, `None` otherwise.
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    if let Ok(resp) = req.send().await {
        if let Some(len) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
            if let Ok(s) = len.to_str() {
                if let Ok(v) = s.parse::<u64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Ensures sufficient disk space is available for the download.
///
/// Checks the available disk space on the target filesystem and returns an
/// error if it's insufficient. Currently implemented for Unix-like systems only.
/// Windows and other platforms skip the check.
///
/// # Arguments
///
/// * `target_path` - Path where the file will be saved
/// * `needed_bytes` - Total bytes required (including safety margin)
///
/// # Returns
///
/// Returns `Ok(())` if sufficient space is available or the check cannot be performed.
///
/// # Errors
///
/// Returns `ERR::DISK_FULL` if available space is less than or equal to needed bytes.
fn ensure_free_space(target_path: &Path, needed_bytes: u64) -> Result<(), String> {
    #[cfg(target_family = "unix")]
    {
        use libc::{statvfs, statvfs as statvfs_t};
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::unix::ffi::OsStrExt;
        let dir = target_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let c_path =
            CString::new(dir.as_os_str().as_bytes()).map_err(|_| "ERR::DISK_FULL".to_string())?;
        unsafe {
            let mut stat: MaybeUninit<statvfs_t> = MaybeUninit::uninit();
            if statvfs(c_path.as_ptr(), stat.as_mut_ptr()) != 0 {
                return Ok(()); // 取得失敗はスキップ
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

/// Retries a download operation up to 3 times with linear backoff.
///
/// This function wraps download operations and automatically retries them on
/// network-related errors (e.g., timeout, connection errors). Non-retryable
/// errors are returned immediately.
///
/// Backoff strategy: 500ms, 1000ms, 1500ms for attempts 1, 2, 3.
///
/// # Arguments
///
/// * `f` - A closure that returns a Future resolving to a download result
///
/// # Returns
///
/// Returns `Ok(())` if the download succeeds on any attempt.
///
/// # Errors
///
/// Returns an error if:
/// - All retry attempts are exhausted
/// - A non-retryable error occurs (e.g., ERR::DISK_FULL)
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    let mut attempt: u8 = 0;
    let max_attempts: u8 = 3;
    loop {
        attempt += 1;
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                // ネットワーク/一時的エラーのみ再試行 (雑判定)
                let is_retryable = msg.contains("segment")
                    || msg.contains("request error")
                    || msg.contains("timeout")
                    || msg.contains("connect");
                if attempt >= max_attempts || !is_retryable {
                    return Err(if msg.contains("ERR::") {
                        msg
                    } else {
                        format!("ERR::NETWORK::{msg}")
                    });
                }
                let backoff_ms = 500u64 * (attempt as u64); // 線形簡易
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                continue;
            }
        }
    }
}

/// Emits a stage change event to the frontend.
///
/// Creates a new Emits instance and spawns a task to set the specified stage.
/// If the stage is "complete", it also calls the complete() method to finalize
/// the progress.
///
/// This is a convenience helper for emitting simple stage updates without
/// managing an existing Emits instance.
///
/// # Arguments
///
/// * `app` - Tauri application handle for event emission
/// * `download_id` - Unique identifier for this download
/// * `stage` - Stage name (e.g., "warn-video-quality-fallback", "complete")
fn emit_stage(app: &AppHandle, download_id: &str, stage: &str) {
    // Emits を新規に生成して stage セット (サイズ不明のため None)
    let stage_owned = stage.to_string();
    let emits = crate::emits::Emits::new(app.clone(), download_id.to_string(), None);
    tokio::spawn(async move {
        let _ = emits.set_stage(&stage_owned).await;
        if stage_owned == "complete" {
            emits.complete().await;
        }
    });
}
