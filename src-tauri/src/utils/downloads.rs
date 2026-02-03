//! HTTP Download Utilities
//!
//! This module provides robust HTTP download functionality with support for:
//! - Segmented parallel downloads with Range requests
//! - Automatic retry with backoff
//! - Progress tracking and emission to frontend
//! - Disk space checking
//! - Fallback to single-stream download when Range is not supported

use crate::{
    constants::{
        MAX_RECONNECT_ATTEMPTS, MIN_SPEED_THRESHOLD, REFERER, SPEED_CHECK_SIZE, USER_AGENT,
    },
    emits::Emits,
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

/// Sets the download stage based on filename pattern.
///
/// This function examines the filename prefix and updates the progress stage
/// accordingly. Files starting with "temp_audio" are marked as "audio" stage,
/// and files starting with "temp_video" are marked as "video" stage.
/// This allows the frontend to display which part of the download process is active.
///
/// # Arguments
///
/// * `emits` - Reference to the progress emitter for stage updates
/// * `filename` - The filename to examine for stage detection
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
    if matches!(e.raw_os_error(), Some(28)) {
        return anyhow::anyhow!("ERR::DISK_FULL");
    }
    e.into()
}

/// Adds cookie header to a request builder if provided.
fn apply_cookie(mut req: RequestBuilder, cookie: &Option<String>) -> RequestBuilder {
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    req
}

/// Result of initial speed check.
enum SpeedCheckResult {
    /// Speed is acceptable, continue download
    Acceptable,
    /// Speed is too slow, should reconnect
    Slow,
    /// Not enough data received yet to check speed
    InsufficientData,
}

/// Checks if initial download speed meets minimum threshold.
///
/// # Arguments
///
/// * `received` - Bytes received so far
/// * `start_time` - When download started
/// * `reconnect_attempt` - Current reconnect attempt count
///
/// # Returns
///
/// - `Acceptable`: Speed meets threshold or reconnect attempts exhausted
/// - `Slow`: Speed below threshold and reconnect attempts remain
/// - `InsufficientData`: Not enough data received to measure speed yet
fn check_initial_speed(
    received: u64,
    start_time: Instant,
    reconnect_attempt: u8,
) -> SpeedCheckResult {
    if received < SPEED_CHECK_SIZE {
        return SpeedCheckResult::InsufficientData;
    }

    let elapsed = start_time.elapsed().as_secs_f64();
    if elapsed <= 0.0 {
        return SpeedCheckResult::Acceptable;
    }

    let speed = (received as f64 / elapsed) as u64;
    if speed < MIN_SPEED_THRESHOLD && reconnect_attempt < MAX_RECONNECT_ATTEMPTS {
        return SpeedCheckResult::Slow;
    }

    SpeedCheckResult::Acceptable
}

/// Downloads a file from a URL with segmented parallel downloading.
///
/// This function implements a sophisticated download strategy:
/// 1. Attempts to determine file size via HEAD or Range probe
/// 2. If size is known and Range is supported, splits download into segments
/// 3. Downloads segments in parallel (default: 1 concurrent for Bilibili stability)
/// 4. Emits progress updates every 100ms
/// 5. Falls back to single-stream download if Range is not supported
///
/// The function automatically retries failed segments up to 3 times with
/// exponential backoff.
///
/// # Arguments
///
/// * `app` - Tauri application handle for event emission
/// * `url` - URL to download from
/// * `output_path` - Destination file path
/// * `cookie` - Optional cookie header for authentication
/// * `is_override` - Whether to overwrite existing files
/// * `download_id` - Optional identifier for progress tracking
///
/// # Returns
///
/// Returns `Ok(())` on successful download.
///
/// # Errors
///
/// Returns an error if:
/// - File already exists and `is_override` is false (`ERR::FILE_EXISTS`)
/// - Disk space is insufficient (`ERR::DISK_FULL`)
/// - Network requests fail after retries
/// - File size mismatch occurs
pub async fn download_url(
    app: &AppHandle,
    url: String,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
    download_id: Option<String>,
) -> Result<()> {
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

    // ---- 1. Determine total file size ----
    let total_size = fetch_total_size(&client, &url, &cookie).await;

    let total = match total_size {
        Some(size) => size,
        None => {
            // Range not supported or size unknown → fallback to single stream
            return single_stream_fallback(
                app,
                url,
                output_path,
                cookie,
                is_override,
                download_id.clone(),
            )
            .await;
        }
    };

    // ---- 2. Plan segments ----
    const DEFAULT_SEGMENT_MB: u64 = 16;
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

    let downloaded_total = Arc::new(AtomicU64::new(0));
    let sem = Arc::new(Semaphore::new(concurrency));

    // ---- 5. Download segments in parallel ----
    let mut futs = FuturesUnordered::new();
    for (idx, (s, e)) in segments.iter().cloned().enumerate() {
        let url_c = url.clone();
        let cookie_c = cookie.clone();
        let path_c = output_path.clone();
        let client_c = client.clone();
        let dl_total_c = downloaded_total.clone();
        let emits_c = emits.clone();
        let sem_c = sem.clone();
        futs.push(tokio::spawn(async move {
            let _permit = sem_c.acquire().await.unwrap();
            let mut attempt: u8 = 0;
            const MAX_SEG_RETRIES: u8 = 3;
            let size = e - s + 1;
            let mut reconnect_attempt: u8 = 0;

            loop {
                attempt += 1;
                let req = apply_cookie(
                    client_c
                        .get(&url_c)
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

                        // Download segment with speed check and progress updates
                        let emits_c_for_callback = emits_c.clone();
                        let download_result = download_segment_with_speed_check(
                            &mut resp,
                            idx,
                            size,
                            attempt,
                            MAX_SEG_RETRIES,
                            reconnect_attempt,
                            |chunk_len| {
                                // Emit progress update via watch channel (non-blocking)
                                // Note: Use relaxed ordering for progress tracking only
                                let current = dl_total_c.load(Ordering::Relaxed);
                                emits_c_for_callback.update_progress(current + chunk_len);
                            },
                        )
                        .await;

                        let (buf, received, _reconnect_needed) = match download_result {
                            Ok(result) => result,
                            Err(reconnect) if reconnect => {
                                reconnect_attempt += 1;
                                backoff_sleep(reconnect_attempt).await;
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

                        // Add confirmed segment size to total (matching pre-change behavior)
                        let new_total = dl_total_c.fetch_add(size, Ordering::Relaxed) + size;
                        emits_c.update_progress(new_total);

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

    emits.complete().await;
    Ok(())
}

/// Downloads a segment with initial speed check.
///
/// This function downloads data from a response stream while performing
/// periodic speed checks. If the download speed falls below the minimum
/// threshold, it signals that a reconnect is needed.
///
/// # Arguments
///
/// * `resp` - Mutable reference to the HTTP response to read from
/// * `_idx` - Segment index (for error reporting, currently unused)
/// * `size` - Expected segment size in bytes
/// * `attempt` - Current retry attempt number
/// * `max_seg_retries` - Maximum number of retries allowed
/// * `reconnect_attempt` - Current reconnect attempt due to slow speed
/// * `on_chunk_received` - Callback invoked when each chunk is received with the chunk size in bytes.
///   This callback is called for every chunk received, allowing the caller to track progress
///   and update download statistics in real-time.
///
/// # Returns
///
/// - `Ok((buf, received, false))`: Download complete successfully.
///   - `buf` contains the downloaded data
///   - `received` is the total bytes received
///   - `false` indicates no reconnect needed
/// - `Err(true)`: Speed too slow, reconnect needed
/// - `Err(false)`: Download failed (non-recoverable, max retries exceeded)
async fn download_segment_with_speed_check(
    resp: &mut reqwest::Response,
    _idx: usize,
    size: u64,
    attempt: u8,
    max_seg_retries: u8,
    reconnect_attempt: u8,
    on_chunk_received: impl Fn(u64),
) -> Result<(Vec<u8>, u64, bool), bool> {
    let mut buf = Vec::with_capacity(size.min(8 * 1024 * 1024) as usize);
    let mut received: u64 = 0;
    let start_time = Instant::now();
    let mut speed_checked = false;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let chunk_len = chunk.len() as u64;
                received += chunk_len;
                buf.extend_from_slice(&chunk);

                // Report progress on chunk received
                on_chunk_received(chunk_len);

                // Perform speed check when enough data received
                if !speed_checked && received >= SPEED_CHECK_SIZE {
                    match check_initial_speed(received, start_time, reconnect_attempt) {
                        SpeedCheckResult::Slow => return Err(true), // Reconnect needed
                        SpeedCheckResult::Acceptable => speed_checked = true,
                        SpeedCheckResult::InsufficientData => {}
                    }
                }
            }
            Ok(None) => {
                speed_checked = true;
                break;
            }
            Err(_) => {
                if attempt < max_seg_retries {
                    backoff_sleep(attempt).await;
                    continue;
                }
                return Err(false);
            }
        }
    }

    // If speed check failed and download incomplete, signal reconnect
    if !speed_checked && received < size {
        return Err(true);
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
async fn single_stream_fallback(
    app: &AppHandle,
    url: String,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
    download_id: Option<String>,
) -> Result<()> {
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
        file.write_all(&chunk).await.map_err(map_io_error)?;
        downloaded += chunk.len() as u64;
        // Emit progress update via watch channel (non-blocking)
        emits_for_callback.update_progress(downloaded);
    }

    file.flush().await.map_err(map_io_error)?;
    emits.complete().await;
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
