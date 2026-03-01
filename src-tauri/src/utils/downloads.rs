//! HTTP Download Utilities
//!
//! This module provides robust HTTP download functionality with support for:
//! - Segmented parallel downloads with Range requests
//! - Automatic retry with backoff
//! - Progress tracking and emission to frontend
//! - Disk space checking
//! - Fallback to single-stream download when Range is not supported
//! - Download cancellation support

use crate::{
    constants::{
        MAX_CDN_LOOPS, MIN_DATA_FOR_SPEED_CHECK, MIN_SPEED_THRESHOLD, REFERER,
        SPEED_CHECK_INTERVAL_SECS, USER_AGENT,
    },
    emits::Emits,
    handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY,
};
use anyhow::Result;
use futures::stream::FuturesUnordered;
use futures::StreamExt;
use reqwest::header;
use reqwest::RequestBuilder;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::Semaphore;
use tokio::{fs, io::AsyncSeekExt, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// Sets the download stage based on filename pattern.
///
/// Files starting with "temp_audio" are marked as "audio" stage,
/// and files starting with "temp_video" are marked as "video" stage.
/// This allows the frontend to display which part of the download process is active.
async fn set_stage_from_filename(emits: &Emits, filename: &str) {
    let stage = if filename.starts_with("temp_audio") {
        Some("audio")
    } else if filename.starts_with("temp_video") {
        Some("video")
    } else {
        None
    };

    if let Some(s) = stage {
        let _ = emits.set_stage(s).await;
    }
}

/// Converts an I/O error to an appropriate anyhow error.
/// Returns `ERR::DISK_FULL` for ENOSPC (error code 28), otherwise wraps the original error.
fn map_io_error(e: std::io::Error) -> anyhow::Error {
    match e.raw_os_error() {
        Some(28) => anyhow::anyhow!("ERR::DISK_FULL"),
        _ => e.into(),
    }
}

/// Adds cookie header to a request builder if provided.
fn apply_cookie(mut req: RequestBuilder, cookie: &Option<String>) -> RequestBuilder {
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    req
}

/// Checks if cancellation has been requested.
/// Returns an error if the token exists and is cancelled.
fn check_cancelled(token: &Option<CancellationToken>) -> Result<()> {
    if let Some(t) = token {
        if t.is_cancelled() {
            return Err(anyhow::anyhow!("ERR::CANCELLED"));
        }
    }
    Ok(())
}

/// Speed check result.
enum SpeedCheckResult {
    Acceptable,       // Speed is acceptable, continue download
    Slow,             // Speed is too slow, should reconnect
    InsufficientData, // Not enough data or time for speed check
}

/// Checks if download speed meets minimum threshold.
///
/// Uses time-based speed checking with configurable interval and minimum data
/// requirements. This improves detection of slow networks compared to the
/// previous byte-threshold approach.
///
/// # Arguments
///
/// * `received` - Total bytes received so far
/// * `last_check_time` - Time of the last speed check
/// * `last_check_bytes` - Bytes received at the last speed check
/// * `cdn_rotation_count` - Current CDN rotation count
/// * `cdn_urls_len` - Total number of available CDN URLs
///
/// # Returns
///
/// - Acceptable: Speed meets threshold or max rotations reached
/// - Slow: Speed below threshold and rotations remain
/// - InsufficientData: Not enough time elapsed or data received
fn check_download_speed(
    received: u64,
    last_check_time: Instant,
    last_check_bytes: u64,
    cdn_rotation_count: u8,
    cdn_urls_len: usize,
) -> SpeedCheckResult {
    // Minimum data check (100KB)
    let bytes_since_check = received.saturating_sub(last_check_bytes);
    if bytes_since_check < MIN_DATA_FOR_SPEED_CHECK {
        return SpeedCheckResult::InsufficientData;
    }

    // Time elapsed check (3 seconds)
    let elapsed = last_check_time.elapsed().as_secs();
    if elapsed < SPEED_CHECK_INTERVAL_SECS {
        return SpeedCheckResult::InsufficientData;
    }

    // Calculate speed
    let speed = (bytes_since_check as f64 / elapsed as f64) as u64;

    // Check if rotation limit reached (CDN count × MAX_CDN_LOOPS)
    // Use saturating operations to prevent overflow with large CDN lists
    let max_rotations = (cdn_urls_len.min(255) as u8).saturating_mul(MAX_CDN_LOOPS);
    if speed < MIN_SPEED_THRESHOLD && cdn_rotation_count < max_rotations {
        return SpeedCheckResult::Slow;
    }

    SpeedCheckResult::Acceptable
}

/// Downloads a file from URL with CDN rotation support.
///
/// When download speed drops below threshold, automatically switches to
/// backup CDN URLs if provided. Supports cancellation via global registry.
#[allow(clippy::too_many_arguments)]
pub async fn download_url(
    app: &AppHandle,
    url: String,
    backup_urls: Option<Vec<String>>,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
    download_id: Option<String>,
    override_stage: Option<&str>,
    emit_complete: bool,
) -> Result<()> {
    // Get cancellation token from registry
    let cancel_token: Option<CancellationToken> = if let Some(ref id) = download_id {
        DOWNLOAD_CANCEL_REGISTRY.get_token(id).await
    } else {
        None
    };

    // Initial cancellation check
    check_cancelled(&cancel_token)?;

    // File existence check
    if output_path.exists() {
        if is_override {
            fs::remove_file(&output_path).await?;
        } else {
            return Err(anyhow::anyhow!("ERR::FILE_EXISTS"));
        }
    }

    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(120))
        .build()?;

    // Build list of all CDN URLs (primary + backups)
    let mut cdn_urls = vec![url.clone()];
    if let Some(ref backups) = backup_urls {
        cdn_urls.extend(backups.clone());
    }

    // ---- 1. Determine total file size ----
    let total_size = fetch_total_size(&client, &url, &cookie).await;

    let total = match total_size {
        Some(size) => size,
        None => {
            // Range not supported or size unknown → fallback to single stream
            return single_stream_fallback(
                app,
                url,
                backup_urls,
                output_path,
                cookie,
                is_override,
                download_id.clone(),
                override_stage,
                emit_complete,
            )
            .await;
        }
    };

    // ---- 2. Plan segments ----
    const DEFAULT_SEGMENT_MB: u64 = 8;
    let segment_size = DEFAULT_SEGMENT_MB * 1024 * 1024;
    let segments: Vec<(u64, u64)> = calculate_segments(total, segment_size);

    // NOTE: Bilibili CDN is unstable with parallel requests, so fixed to 1
    let concurrency: usize = 1;

    // ---- 3. Pre-allocate file ----
    preallocate_file(&output_path, total).await?;

    // ---- 4. Setup progress emitter ----
    let id_for_emit = download_id.clone().unwrap_or_else(|| filename.to_string());
    let emits = Arc::new(Emits::new(app.clone(), id_for_emit, Some(total)));
    set_stage_from_filename(&emits, filename).await;
    if let Some(stage) = override_stage {
        let _ = emits.set_stage(stage).await;
    }

    let downloaded_total = Arc::new(AtomicU64::new(0));
    let sem = Arc::new(Semaphore::new(concurrency));

    // ---- 5. Download segments in parallel ----
    let mut futs = FuturesUnordered::new();
    for (idx, (s, e)) in segments.iter().cloned().enumerate() {
        let cdn_urls_c = cdn_urls.clone();
        let cookie_c = cookie.clone();
        let path_c = output_path.clone();
        let client_c = client.clone();
        let dl_total_c = downloaded_total.clone();
        let emits_c = emits.clone();
        let sem_c = sem.clone();
        let cancel_token_c = cancel_token.clone();
        futs.push(tokio::spawn(async move {
            let _permit = sem_c.acquire().await.unwrap();

            // Check cancellation before starting segment
            if let Some(ref t) = cancel_token_c {
                if t.is_cancelled() {
                    return Err(anyhow::anyhow!("ERR::CANCELLED"));
                }
            }

            let mut attempt: u8 = 0;
            const MAX_SEG_RETRIES: u8 = 3;
            let size = e - s + 1;
            let mut cdn_rotation_count: u8 = 0;
            // Track bytes this segment has added to dl_total_c
            // for rollback on retry
            let seg_bytes_added = Arc::new(AtomicU64::new(0));

            loop {
                attempt += 1;

                // Check cancellation on each retry
                if let Some(ref t) = cancel_token_c {
                    if t.is_cancelled() {
                        return Err(anyhow::anyhow!("ERR::CANCELLED"));
                    }
                }

                // Roll back previously added bytes on retry
                let prev = seg_bytes_added.swap(0, Ordering::Relaxed);
                if prev > 0 {
                    dl_total_c.fetch_sub(prev, Ordering::Relaxed);
                    // Reset progress display after rollback
                    emits_c.update_progress(dl_total_c.load(Ordering::Relaxed));
                }

                // Select CDN URL based on rotation count (CDN rotation with loop)
                let cdn_idx = (cdn_rotation_count as usize) % cdn_urls_c.len();
                let current_url = &cdn_urls_c[cdn_idx];

                let req = apply_cookie(
                    client_c
                        .get(current_url)
                        .header(header::RANGE, format!("bytes={}-{}", s, e))
                        .header(header::REFERER, REFERER),
                    &cookie_c,
                );
                match req.send().await {
                    Ok(mut resp) => {
                        // Validate response status
                        let is_valid_response = resp.status() == 206
                            || (s == 0
                                && resp.status() == 200
                                && size == resp.content_length().unwrap_or(size));

                        if !is_valid_response {
                            if attempt < MAX_SEG_RETRIES {
                                backoff_sleep(attempt).await;
                                continue;
                            }
                            return Err(anyhow::anyhow!(
                                "segment {} unexpected status {}",
                                idx,
                                resp.status()
                            ));
                        }

                        // Download segment with progress tracking
                        let emits_cb = emits_c.clone();
                        let dl_total_cb = dl_total_c.clone();
                        let seg_bytes_cb = seg_bytes_added.clone();
                        let download_result = download_segment_with_speed_check(
                            &mut resp,
                            idx,
                            size,
                            attempt,
                            MAX_SEG_RETRIES,
                            cdn_rotation_count,
                            cdn_urls_c.len(),
                            |chunk_len| {
                                seg_bytes_cb.fetch_add(chunk_len, Ordering::Relaxed);
                                let new_total =
                                    dl_total_cb.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len;
                                emits_cb.update_progress(new_total);
                            },
                        )
                        .await;

                        let (buf, received, _) = match download_result {
                            Ok(result) => result,
                            Err(reconnect) if reconnect => {
                                // Switch to next CDN URL on reconnect (loops back to start)
                                let next_cdn_idx =
                                    (cdn_rotation_count as usize + 1) % cdn_urls_c.len();
                                eprintln!(
                                    "[CDN] Segment {}: rotating CDN #{} → #{} (rotation {}/{})",
                                    idx,
                                    cdn_idx,
                                    next_cdn_idx,
                                    cdn_rotation_count + 1,
                                    (cdn_urls_c.len().min(255) as u8).saturating_mul(MAX_CDN_LOOPS)
                                );
                                cdn_rotation_count += 1;
                                backoff_sleep(cdn_rotation_count).await;
                                continue;
                            }
                            Err(_) => {
                                return Err(anyhow::anyhow!("segment {} download failed", idx))
                            }
                        };

                        // Verify size
                        if received != size {
                            if attempt < MAX_SEG_RETRIES {
                                backoff_sleep(attempt).await;
                                continue;
                            }
                            return Err(anyhow::anyhow!("segment {} size mismatch", idx));
                        }

                        // Write to file
                        write_segment(&path_c, s, &buf).await?;

                        return Ok(());
                    }
                    Err(e) => {
                        if attempt < MAX_SEG_RETRIES {
                            backoff_sleep(attempt).await;
                            continue;
                        }
                        return Err(anyhow::anyhow!("segment {} request error: {e}", idx));
                    }
                }
            }
        }));
    }

    // Collect results
    let mut seg_errors = 0u32;
    while let Some(res) = futs.next().await {
        match res {
            Ok(Ok(())) => {}
            Ok(Err(_)) | Err(_) => seg_errors += 1,
        }
    }

    if seg_errors > 0 {
        return Err(anyhow::anyhow!("{seg_errors} segment(s) failed"));
    }

    // Final verification
    let final_downloaded = downloaded_total.load(Ordering::Relaxed);
    if final_downloaded != total {
        return Err(anyhow::anyhow!(
            "final size mismatch: {} vs {}",
            final_downloaded,
            total
        ));
    }

    if emit_complete {
        emits.complete().await;
    } else {
        // Stop background task without emitting complete event
        emits.stop().await;
    }
    Ok(())
}

/// Downloads a segment with time-based speed check.
///
/// This function downloads data from a response stream while performing
/// periodic speed checks at configured intervals. If the download speed
/// falls below the minimum threshold, it signals that a reconnect is needed.
///
/// # Arguments
///
/// * `resp` - Mutable reference to the HTTP response to read from
/// * `_idx` - Segment index (reserved for future error reporting)
/// * `size` - Expected segment size in bytes
/// * `attempt` - Current retry attempt number
/// * `max_seg_retries` - Maximum number of retries allowed
/// * `cdn_rotation_count` - Current CDN rotation count
/// * `cdn_urls_len` - Total number of available CDN URLs
/// * `on_chunk_received` - Callback invoked when each chunk is received
///
/// # Returns
///
/// - `Ok((buf, received, false))`: Download complete successfully.
///   - `buf` contains the downloaded data
///   - `received` is the total bytes received
///   - `false` indicates no reconnect needed
/// - `Err(true)`: Speed too slow, reconnect needed
/// - `Err(false)`: Download failed (non-recoverable, max retries exceeded)
#[allow(clippy::too_many_arguments)]
async fn download_segment_with_speed_check(
    resp: &mut reqwest::Response,
    _idx: usize,
    size: u64,
    attempt: u8,
    max_seg_retries: u8,
    cdn_rotation_count: u8,
    cdn_urls_len: usize,
    on_chunk_received: impl Fn(u64),
) -> Result<(Vec<u8>, u64, bool), bool> {
    let mut buf = Vec::with_capacity(size.min(8 * 1024 * 1024) as usize);
    let mut received: u64 = 0;

    // Time-based speed check variables
    let mut last_check_time = Instant::now();
    let mut last_check_bytes: u64 = 0;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let chunk_len = chunk.len() as u64;
                received += chunk_len;
                buf.extend_from_slice(&chunk);

                // Report progress on chunk received
                on_chunk_received(chunk_len);

                // Perform time-based speed check
                match check_download_speed(
                    received,
                    last_check_time,
                    last_check_bytes,
                    cdn_rotation_count,
                    cdn_urls_len,
                ) {
                    SpeedCheckResult::Slow => return Err(true), // Reconnect needed
                    SpeedCheckResult::Acceptable => {
                        // Reset check counters for next interval
                        last_check_time = Instant::now();
                        last_check_bytes = received;
                    }
                    SpeedCheckResult::InsufficientData => {}
                }
            }
            Ok(None) => break,
            Err(_) => {
                if attempt < max_seg_retries {
                    backoff_sleep(attempt).await;
                    continue;
                }
                return Err(false);
            }
        }
    }

    Ok((buf, received, false))
}

/// Writes a segment buffer to the file at the specified position.
async fn write_segment(path: &PathBuf, pos: u64, buf: &[u8]) -> Result<(), anyhow::Error> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(map_io_error)?;

    file.seek(std::io::SeekFrom::Start(pos))
        .await
        .map_err(map_io_error)?;
    file.write_all(buf).await.map_err(map_io_error)?;
    Ok(())
}

/// Fallback single-stream download for when Range requests are not supported.
///
/// Note: CDN rotation is not implemented in fallback mode since parallel
/// downloads are not possible without Range support.
#[allow(clippy::too_many_arguments)]
async fn single_stream_fallback(
    app: &AppHandle,
    url: String,
    _backup_urls: Option<Vec<String>>, // Unused in fallback mode
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
    download_id: Option<String>,
    override_stage: Option<&str>,
    emit_complete: bool,
) -> Result<()> {
    // Get cancellation token from registry if download_id is provided
    let cancel_token: Option<CancellationToken> = if let Some(ref id) = download_id {
        DOWNLOAD_CANCEL_REGISTRY.get_token(id).await
    } else {
        None
    };

    // Initial cancellation check
    check_cancelled(&cancel_token)?;

    // Check file existence
    if output_path.exists() {
        if is_override {
            fs::remove_file(&output_path).await.ok();
        } else {
            return Err(anyhow::anyhow!("ERR::FILE_EXISTS"));
        }
    }

    // Build and send request
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build()?;
    let req = apply_cookie(client.get(&url).header(header::REFERER, REFERER), &cookie);
    let mut resp = req.send().await?;
    let total = resp.content_length();

    // Setup emitter
    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let id_for_emit = download_id.unwrap_or_else(|| filename.to_string());
    let emits = Arc::new(Emits::new(app.clone(), id_for_emit, total));
    set_stage_from_filename(&emits, filename).await;
    if let Some(stage) = override_stage {
        let _ = emits.set_stage(stage).await;
    }

    // Open file and download
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&output_path)
        .await
        .map_err(map_io_error)?;

    let mut downloaded: u64 = 0;
    let emits_for_callback = emits.clone();
    while let Some(chunk) = resp.chunk().await? {
        // Check cancellation on each chunk
        check_cancelled(&cancel_token)?;

        file.write_all(&chunk).await.map_err(map_io_error)?;
        downloaded += chunk.len() as u64;
        // Emit progress update via watch channel (non-blocking)
        emits_for_callback.update_progress(downloaded);
    }

    file.flush().await.map_err(map_io_error)?;
    if emit_complete {
        emits.complete().await;
    } else {
        // Stop background task without emitting complete event
        emits.stop().await;
    }
    Ok(())
}

/// Implements exponential backoff sleep for retry logic.
async fn backoff_sleep(attempt: u8) {
    // Cap at 3000ms: 500ms (attempt 1), 1000ms (attempt 2), 2000ms (attempt 3+)
    let ms = (500u64 << attempt.saturating_sub(1)).min(3000);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Attempts to fetch total file size via HEAD request or Range probe.
async fn fetch_total_size(
    client: &reqwest::Client,
    url: &str,
    cookie: &Option<String>,
) -> Option<u64> {
    // Try HEAD request first
    let head_req = apply_cookie(client.head(url).header(header::REFERER, REFERER), cookie);
    if let Ok(resp) = head_req.send().await {
        if let Some(len) = resp.headers().get(header::CONTENT_LENGTH) {
            if let Ok(val) = len.to_str().ok()?.parse::<u64>() {
                return Some(val);
            }
        }
    }

    // Fallback to Range probe: bytes=0-0
    let probe_req = apply_cookie(
        client
            .get(url)
            .header(header::RANGE, "bytes=0-0")
            .header(header::REFERER, REFERER),
        cookie,
    );
    let Ok(resp) = probe_req.send().await else {
        return None;
    };

    // Format: "bytes START-END/TOTAL"
    resp.headers()
        .get(header::CONTENT_RANGE)
        .and_then(|cr| cr.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|v| v.parse::<u64>().ok())
}

/// Calculates segment ranges for segmented download.
///
/// Divides the total file size into segments of the specified size.
/// Each segment is represented as a (start, end) byte range tuple.
/// The last segment may be smaller if the total size is not evenly divisible.
fn calculate_segments(total: u64, segment_size: u64) -> Vec<(u64, u64)> {
    let mut segments = Vec::new();
    let mut start = 0;
    while start < total {
        let end = (start + segment_size - 1).min(total - 1);
        segments.push((start, end));
        start = end + 1;
    }
    segments
}

/// Pre-allocates file with specified size, checking for disk space.
async fn preallocate_file(path: &PathBuf, size: u64) -> Result<()> {
    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .await
        .map_err(map_io_error)?;

    file.set_len(size).await.map_err(map_io_error)?;
    Ok(())
}
