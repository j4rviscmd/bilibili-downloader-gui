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
        MAX_CDN_LOOPS, MIN_DATA_FOR_SPEED_CHECK, MIN_MEDIA_BYTES, MIN_SPEED_THRESHOLD, REFERER,
        SPEED_CHECK_INTERVAL_SECS, USER_AGENT,
    },
    emits::Emits,
    handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY,
    utils::cdn_selector,
};

/// Error type for segment download failures.
#[derive(Debug)]
enum SegmentError {
    /// Reconnect required due to slow speed detection or stream error
    /// (triggers CDN rotation via caller's loop)
    Reconnect,
}
use anyhow::Result;
use futures::stream::FuturesUnordered;
use futures::StreamExt;
use reqwest::header;
use reqwest::RequestBuilder;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
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

/// Adds a Cookie header to a request builder when credentials are supplied.
///
/// This is a no-op when `cookie` is `None` or empty. Returns the modified
/// `RequestBuilder` for chaining.
///
/// # Arguments
///
/// * `req` - Request builder to attach the header to
/// * `cookie` - Optional cookie header value
fn apply_cookie(mut req: RequestBuilder, cookie: &Option<String>) -> RequestBuilder {
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    req
}

/// Checks whether a download cancellation has been requested.
///
/// Returns `Err` with `ERR::CANCELLED` when a cancellation token exists and
/// has already been triggered. Used at strategic checkpoints (file
/// existence, before each chunk write, before retry attempts) to short
/// circuit in-flight downloads.
///
/// # Arguments
///
/// * `token` - Optional cancellation token registered via
///   `DOWNLOAD_CANCEL_REGISTRY`
///
/// # Returns
///
/// - `Ok(())` if no token is registered or the token is not cancelled.
/// - `Err` containing `ERR::CANCELLED` when cancellation has been requested.
fn check_cancelled(token: &Option<CancellationToken>) -> Result<()> {
    if token.as_ref().is_some_and(|t| t.is_cancelled()) {
        return Err(anyhow::anyhow!("ERR::CANCELLED"));
    }
    Ok(())
}

/// Outcome of a time-based download speed check.
///
/// Produced by [`check_download_speed`] to signal whether the current
/// throughput should continue, trigger a CDN rotation, or wait for more
/// data before evaluating.
enum SpeedCheckResult {
    /// Throughput is at or above [`MIN_SPEED_THRESHOLD`]; continue as-is.
    Acceptable,
    /// Throughput is below threshold and CDN rotations remain; reconnect.
    Slow,
    /// Not enough elapsed time or bytes received yet for a reliable check.
    InsufficientData,
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

/// Downloads a file from a URL with automatic CDN rotation and retry.
///
/// Orchestrates the full segmented download pipeline used for audio and
/// video streams:
///
/// 1. Resolves and registers a cancellation token via
///    `DOWNLOAD_CANCEL_REGISTRY`.
/// 2. Handles existing file (override or error), then runs CDN
///    pre-selection via [`crate::utils::cdn_selector::select_best_cdns`]
///    (static P2P demotion + latency probe) which also recovers the total
///    size.
/// 3. Falls back to [`single_stream_fallback`] when the server does not
///    advertise `Accept-Ranges`/Content-Length.
/// 4. Splits the payload into 8 MB segments (concurrency pinned to 1
///    because Bilibili's CDN is unstable with parallel range requests).
/// 5. Pre-allocates the output file and emits progress updates via
///    [`Emits`] to the frontend.
/// 6. Streams each segment through [`download_segment_with_speed_check`],
///    transparently rotating CDN URLs when throughput drops below
///    [`MIN_SPEED_THRESHOLD`] and rolling back any progress that was
///    already reported for a segment being retried.
/// 7. Verifies the final byte count against the advertised total and
///    emits either `complete` or `stop` to the frontend.
///
/// When download speed drops below threshold, automatically switches to
/// backup CDN URLs if provided. Supports cancellation via global registry.
///
/// # Arguments
///
/// * `app` - Tauri application handle used for event emission
/// * `url` - Primary CDN URL to download from
/// * `backup_urls` - Optional list of backup CDN URLs for rotation
/// * `output_path` - Destination file path
/// * `cookie` - Optional Cookie header value for authenticated requests
/// * `is_override` - When `true`, overwrites an existing file; otherwise
///   returns `ERR::FILE_EXISTS`
/// * `download_id` - Optional unique ID used to register a cancellation
///   token and scope emitted events
/// * `override_stage` - Optional stage label (e.g., `"audio"`, `"video"`)
///   forced onto the emitter regardless of filename
/// * `emit_complete` - When `true`, emits the `complete` event on success;
///   when `false`, calls `Emits::stop` to terminate the progress task
///   without notifying the frontend (used for intermediate temp files
///   that are merged later)
///
/// # Returns
///
/// Returns `Ok(())` on successful download and verification.
///
/// # Errors
///
/// Returns an anyhow error in the following cases:
/// - `ERR::FILE_EXISTS` - File already exists and `is_override` is `false`
/// - `ERR::CANCELLED` - Download was cancelled via the registry
/// - Segment or final size mismatch after exhausting retries
/// - Disk I/O failure (mapped to `ERR::DISK_FULL` for ENOSPC)
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
    concurrency: usize,
) -> Result<()> {
    log::info!(
        "[BE] download_url: starting download to {:?}, cdn_count={}",
        output_path.file_name().and_then(|n| n.to_str()),
        1 + backup_urls.as_ref().map(|v| v.len()).unwrap_or(0)
    );

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

    // Try to get shared client from app state, fallback to local client
    // Note: the fallback is a safety net for call paths where the managed
    //   shared client is unavailable (e.g. non-app contexts); it mirrors the
    //   shared client's timeout and pool sizing (issue #491).
    let client: Arc<reqwest::Client> = match app.try_state::<Arc<reqwest::Client>>() {
        Some(state) => state.inner().clone(),
        None => {
            log::warn!("[BE] Shared client not found in app state, using local client");
            Arc::new(
                reqwest::Client::builder()
                    .user_agent(USER_AGENT)
                    .timeout(Duration::from_secs(120))
                    .pool_max_idle_per_host(concurrency)
                    .build()
                    .expect("Failed to build fallback HTTP client"),
            )
        }
    };

    // Build list of all CDN URLs (primary + backups)
    let mut cdn_urls = vec![url.clone()];
    if let Some(ref backups) = backup_urls {
        cdn_urls.extend(backups.clone());
    }

    // ---- 1. CDN Pre-selection ----
    // Use CDN selector to probe and order CDNs by performance
    // Why: avoid landing the primary request on a slow P2P/MCDN edge (e.g.
    //   *.mcdn.bilivideo.cn) by excluding/demoting it up front and probing the
    //   candidate CDNs in parallel for latency instead of reacting to slowness
    //   mid-download (issue #490).
    let cdn_outcome = cdn_selector::select_best_cdns(cdn_urls.clone(), cookie.clone()).await;

    let ordered_urls = cdn_outcome.ordered_urls;
    let total = match cdn_outcome.total_size {
        Some(size) => size,
        None => {
            // Range not supported or size unknown → fallback to single stream.
            // Prefer the best-ranked CDN over the original (possibly P2P) URL.
            // Why: the original `url` may itself be the P2P node that
            //   pre-selection filtered out, so reusing it here would defeat
            //   pre-selection even in the single-stream path (issue #490).
            let best_url = ordered_urls.first().cloned().unwrap_or_else(|| url.clone());
            return single_stream_fallback(
                app,
                best_url,
                backup_urls,
                output_path,
                cookie,
                is_override,
                download_id.clone(),
                override_stage,
                emit_complete,
                client.clone(),
            )
            .await;
        }
    };

    // Update cdn_urls to use the ordered list from pre-selection
    cdn_urls = ordered_urls;

    // ---- 2. Plan segments ----
    const DEFAULT_SEGMENT_MB: u64 = 8;
    let segment_size = DEFAULT_SEGMENT_MB * 1024 * 1024;
    let segments: Vec<(u64, u64)> = calculate_segments(total, segment_size);

    // Why: segment parallelism is now configurable instead of the previous
    //   hardcoded concurrency=1. The "Bilibili CDN is unstable with parallel
    //   requests" caveat that forced 1 is mitigated by CDN pre-selection
    //   (#490), so users may raise parallelism safely (issue #491).
    log::info!("[BE] download_url: using concurrency: {}", concurrency);

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
                    let _ = emits_c.stop().await;
                    return Err(anyhow::anyhow!("ERR::CANCELLED"));
                }
            }

            // `http_retries` counts HTTP-layer failures (invalid status,
            // request error) bounded by MAX_SEG_RETRIES. CDN-rotation
            // failures (size mismatch, slow speed) use `cdn_rotation_count`.
            // Keeping these budgets independent prevents CDN rotations from
            // inflating the HTTP retry counter — which previously disabled
            // the in-segment chunk-retry budget inside
            // download_segment_with_speed_check and produced misleading
            // `attempt 8/3` log lines.
            let mut http_retries: u8 = 0;
            const MAX_SEG_RETRIES: u8 = 3;
            let size = e - s + 1;
            let mut cdn_rotation_count: u8 = 0;
            let max_cdn_rotations: u8 =
                (cdn_urls_c.len().min(255) as u8).saturating_mul(MAX_CDN_LOOPS);
            // Track bytes this segment has added to dl_total_c
            // for rollback on retry
            let seg_bytes_added = Arc::new(AtomicU64::new(0));

            loop {
                // Check cancellation on each iteration
                if let Some(ref t) = cancel_token_c {
                    if t.is_cancelled() {
                        let _ = emits_c.stop().await;
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
                            http_retries += 1;
                            log::warn!(
                                "[BE] download_url: segment {} invalid status {} (http retry {}/{}, cdn_idx={})",
                                idx,
                                resp.status(),
                                http_retries,
                                MAX_SEG_RETRIES,
                                cdn_idx
                            );
                            if http_retries < MAX_SEG_RETRIES {
                                backoff_sleep(http_retries).await;
                                continue;
                            }
                            return Err(anyhow::anyhow!(
                                "segment {} unexpected status {}",
                                idx,
                                resp.status()
                            ));
                        }

                        // Reject non-media responses. Bilibili serves a JSON
                        // error body with HTTP 200 + matching Content-Length
                        // for gated/expired stream URLs; without this check an
                        // 18-byte error payload is accepted as a valid segment
                        // and later breaks the ffmpeg merge (issue #467).
                        if !is_media_content_type(resp.headers().get(header::CONTENT_TYPE)) {
                            log::error!(
                                "[BE] download_url: segment {} non-media content-type (likely error body), status={}",
                                idx,
                                resp.status()
                            );
                            return Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE"));
                        }

                        // Download segment with progress tracking
                        let emits_cb = emits_c.clone();
                        let dl_total_cb = dl_total_c.clone();
                        let seg_bytes_cb = seg_bytes_added.clone();
                        let download_result = download_segment_with_speed_check(
                            &mut resp,
                            idx,
                            size,
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

                        let (buf, received) = match download_result {
                            Ok(result) => result,
                            Err(SegmentError::Reconnect) => {
                                // Belt-and-suspenders: chunk-stream errors now
                                // reach this arm (issue #494) without the
                                // producer-side budget check that slow-speed
                                // detection has, so guard the rotation budget
                                // here to avoid an unbounded loop when every
                                // CDN returns a broken body stream.
                                // Note: rotation is data-safe — the segment
                                //   buffer lives in memory and reaches disk
                                //   once via write_segment only on the Ok path,
                                //   so `continue` here discards the partial
                                //   buffer and leaves no half-written segment
                                //   (issue #494).
                                if cdn_rotation_count >= max_cdn_rotations {
                                    log::warn!(
                                        "[BE] download_url: segment {} CDN rotation budget exhausted ({}/{}, cdn_idx={})",
                                        idx,
                                        cdn_rotation_count,
                                        max_cdn_rotations,
                                        cdn_idx
                                    );
                                    return Err(anyhow::anyhow!(
                                        "segment {} stream error after CDN rotation budget exhausted",
                                        idx
                                    ));
                                }
                                // Switch to next CDN URL on reconnect (loops back to start)
                                let next_cdn_idx =
                                    (cdn_rotation_count as usize + 1) % cdn_urls_c.len();
                                log::info!(
                                    "[BE] download_url: segment {} rotating CDN #{} → #{} (rotation {}/{})",
                                    idx,
                                    cdn_idx,
                                    next_cdn_idx,
                                    cdn_rotation_count + 1,
                                    max_cdn_rotations
                                );
                                cdn_rotation_count += 1;
                                backoff_sleep(cdn_rotation_count).await;
                                continue;
                            }
                        };

                        // Verify size
                        if received != size {
                            // Size mismatch typically indicates CDN edge cache
                            // corruption or rate-limit cutoff. Rotate to a
                            // different CDN immediately instead of retrying
                            // the same node, which tends to reproduce the
                            // same truncated response.
                            if cdn_rotation_count < max_cdn_rotations {
                                log::warn!(
                                    "[BE] download_url: segment {} size mismatch: expected {}, got {} (cdn rotation {}/{}, cdn_idx={})",
                                    idx,
                                    size,
                                    received,
                                    cdn_rotation_count + 1,
                                    max_cdn_rotations,
                                    cdn_idx
                                );
                                let next_cdn_idx =
                                    (cdn_rotation_count as usize + 1) % cdn_urls_c.len();
                                log::info!(
                                    "[BE] download_url: segment {} rotating CDN #{} → #{} due to size mismatch (rotation {}/{})",
                                    idx,
                                    cdn_idx,
                                    next_cdn_idx,
                                    cdn_rotation_count + 1,
                                    max_cdn_rotations
                                );
                                cdn_rotation_count += 1;
                                backoff_sleep(cdn_rotation_count).await;
                                continue;
                            }
                            // Rotation budget exhausted. Log cdn_rotation_count
                            // (== max_cdn_rotations) rather than +1 so the
                            // displayed attempt never exceeds the denominator.
                            log::warn!(
                                "[BE] download_url: segment {} size mismatch: expected {}, got {} (cdn rotation exhausted {}/{}, cdn_idx={})",
                                idx,
                                size,
                                received,
                                cdn_rotation_count,
                                max_cdn_rotations,
                                cdn_idx
                            );
                            return Err(anyhow::anyhow!("segment {} size mismatch", idx));
                        }

                        // Write to file
                        write_segment(&path_c, s, &buf).await?;

                        return Ok(());
                    }
                    Err(e) => {
                        http_retries += 1;
                        log::warn!(
                            "[BE] download_url: segment {} request error: {e} (http retry {}/{}, cdn_idx={})",
                            idx,
                            http_retries,
                            MAX_SEG_RETRIES,
                            cdn_idx
                        );
                        if http_retries < MAX_SEG_RETRIES {
                            backoff_sleep(http_retries).await;
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
            Ok(Err(e)) => {
                // Propagate invalid-media errors immediately so the caller's
                // fallback logic runs without retrying the same error URL.
                if e.to_string().contains("ERR::INVALID_MEDIA_RESPONSE") {
                    emits.stop().await;
                    return Err(e);
                }
                seg_errors += 1;
            }
            Err(_) => seg_errors += 1,
        }
    }

    if seg_errors > 0 {
        // Stop the background emitter so it doesn't leak a progress loop.
        emits.stop().await;
        return Err(anyhow::anyhow!("{seg_errors} segment(s) failed"));
    }

    // Final verification
    let final_downloaded = downloaded_total.load(Ordering::Relaxed);
    // Why: a dedicated size floor is needed because the issue #467 error body
    // was served with HTTP 200 and a matching Content-Length, so the
    // `final_downloaded != total` check below would pass it as valid. This
    // minimum-size check must run before the total-mismatch check to catch it.
    if final_downloaded < MIN_MEDIA_BYTES {
        log::error!(
            "[BE] download_url: downloaded size too small: {} bytes (min {} bytes) - likely error response",
            final_downloaded,
            MIN_MEDIA_BYTES
        );
        // Stop the background emitter so it doesn't leak a progress loop.
        emits.stop().await;
        return Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE"));
    }
    if final_downloaded != total {
        log::error!(
            "[BE] download_url: final size mismatch: {} vs {}",
            final_downloaded,
            total
        );
        // Stop the background emitter so it doesn't leak a progress loop.
        emits.stop().await;
        return Err(anyhow::anyhow!(
            "final size mismatch: {} vs {}",
            final_downloaded,
            total
        ));
    }

    log::info!(
        "[BE] download_url: download complete, total_bytes={}",
        final_downloaded
    );

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
/// * `cdn_rotation_count` - Current CDN rotation count
/// * `cdn_urls_len` - Total number of available CDN URLs
/// * `on_chunk_received` - Callback invoked when each chunk is received
///
/// # Returns
///
/// - `Ok((buf, received))`: Download complete successfully. `buf` holds
///   the downloaded data, `received` is the total bytes received.
/// - `Err(SegmentError::Reconnect)`: Recoverable — either slow speed was
///   detected or the body stream broke mid-transfer (e.g. connection reset,
///   decoding error). The caller rotates to the next CDN URL and retries
///   this segment.
async fn download_segment_with_speed_check(
    resp: &mut reqwest::Response,
    _idx: usize,
    size: u64,
    cdn_rotation_count: u8,
    cdn_urls_len: usize,
    on_chunk_received: impl Fn(u64),
) -> Result<(Vec<u8>, u64), SegmentError> {
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
                    SpeedCheckResult::Slow => return Err(SegmentError::Reconnect), // Reconnect needed
                    SpeedCheckResult::Acceptable => {
                        // Reset check counters for next interval
                        last_check_time = Instant::now();
                        last_check_bytes = received;
                    }
                    SpeedCheckResult::InsufficientData => {}
                }
            }
            Ok(None) => break,
            Err(e) => {
                // Chunk-stream error (e.g. connection reset, decoding error).
                // The stream is broken, so retrying chunk() on the same
                // response cannot recover — trigger CDN rotation in the
                // caller's download_url loop, which retries this segment on
                // the next CDN URL.
                // Why: all chunk() errors map to Reconnect rather than only
                //   "decoding" ones, because classifying via reqwest's error
                //   message string is fragile across versions. The deliberate
                //   trade-off is losing a same-CDN reconnect chance for a
                //   transient connection reset (issue #494).
                log::warn!(
                    "[BE] download_segment: stream error, triggering CDN rotation: {}",
                    e
                );
                return Err(SegmentError::Reconnect);
            }
        }
    }

    Ok((buf, received))
}

/// Writes a downloaded segment buffer at the specified byte offset.
///
/// Opens the pre-allocated file for random-access write, seeks to `pos`,
/// and flushes `buf`. Disk errors are translated via [`map_io_error`] so
/// that `ENOSPC` surfaces as `ERR::DISK_FULL`.
///
/// # Arguments
///
/// * `path` - Pre-allocated output file path
/// * `pos` - Absolute byte offset where the segment should be written
/// * `buf` - Segment bytes to persist
///
/// # Errors
///
/// Returns an anyhow error on open, seek, or write failure (including
/// `ERR::DISK_FULL`).
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
/// Used when [`crate::utils::cdn_selector::select_best_cdns`] returns
/// `total_size: None`, which typically means the
/// server did not return `Content-Length` or `Content-Range` headers. The
/// entire response is streamed sequentially into a single file with
/// per-chunk cancellation checks and progress emission.
///
/// Note: CDN rotation is not implemented in fallback mode since parallel
/// downloads are not possible without Range support.
///
/// # Arguments
///
/// * `app` - Tauri application handle used for event emission
/// * `url` - URL to download (CDN rotation is not applied in fallback mode)
/// * `_backup_urls` - Unused; backup URLs cannot be used without range support
/// * `output_path` - Destination file path
/// * `cookie` - Optional Cookie header value for authenticated requests
/// * `is_override` - When `true`, overwrites an existing file; otherwise
///   returns `ERR::FILE_EXISTS`
/// * `download_id` - Optional unique ID used for cancellation registration
///   and event scoping
/// * `override_stage` - Optional stage label forced onto the emitter
/// * `emit_complete` - When `true`, emits `complete`; otherwise calls
///   `Emits::stop` after the stream ends
///
/// # Errors
///
/// Returns an anyhow error in the following cases:
/// - `ERR::FILE_EXISTS` - File already exists and `is_override` is `false`
/// - `ERR::CANCELLED` - Download was cancelled via the registry
/// - Disk I/O failure (mapped to `ERR::DISK_FULL` for ENOSPC)
/// - HTTP/streaming failure from the underlying reqwest response
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
    client: Arc<reqwest::Client>,
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

    // Build and send request using the shared client
    let req = apply_cookie(client.get(&url).header(header::REFERER, REFERER), &cookie);
    let mut resp = req.send().await?;
    // Reject non-media error responses before streaming to disk (see
    // is_media_content_type). Mirrors the segmented path's guard so the
    // fallback path cannot silently persist a JSON/text error payload.
    if !is_media_content_type(resp.headers().get(header::CONTENT_TYPE)) {
        log::error!(
            "[BE] download_url: single-stream non-media content-type (likely error body), status={}",
            resp.status()
        );
        return Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE"));
    }
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
        if let Err(e) = check_cancelled(&cancel_token) {
            let _ = emits.stop().await;
            return Err(e);
        }

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

/// Implements capped exponential backoff sleep for retry logic.
///
/// Sleep durations double per attempt, capped at 3000 ms:
/// 500 ms (attempt 1), 1000 ms (attempt 2), 2000 ms (attempt 3+).
/// Used between segment download retries to throttle reconnection
/// attempts to unstable CDN nodes.
///
/// # Arguments
///
/// * `attempt` - 1-indexed retry attempt number
async fn backoff_sleep(attempt: u8) {
    // Cap at 3000ms: 500ms (attempt 1), 1000ms (attempt 2), 2000ms (attempt 3+)
    let ms = (500u64 << attempt.saturating_sub(1)).min(3000);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Calculates segment byte ranges for segmented download.
///
/// Divides the total file size into segments of the specified size,
/// each represented as an inclusive `(start, end)` byte range tuple.
/// The last segment is shorter when the total size is not evenly
/// divisible by `segment_size`. Returns an empty vector when
/// `total == 0`.
///
/// # Arguments
///
/// * `total` - Total file size in bytes
/// * `segment_size` - Maximum size of each segment in bytes
///
/// # Returns
///
/// Vector of `(start, end)` inclusive byte ranges, ascending order.
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

/// Pre-allocates the output file to the requested size.
///
/// Creates (or truncates) the file and invokes `set_len` so that the OS
/// reserves the required space up front. This both validates that enough
/// disk space is available and enables parallel segments to seek and
/// write into specific offsets without growing the file each time. I/O
/// errors are translated via [`map_io_error`] so that `ENOSPC` surfaces
/// as `ERR::DISK_FULL`.
///
/// # Arguments
///
/// * `path` - Output file path to create
/// * `size` - Final file size in bytes
///
/// # Errors
///
/// Returns an anyhow error on open or `set_len` failure (including
/// `ERR::DISK_FULL`).
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

// Why: `pub(crate)` (previously private) so cdn_selector can reuse this guard
//   during CDN probing and reject JSON/text error bodies before they are
//   mistaken for valid probe responses — the same issue #467 error-body class.
/// Returns true when the response content-type looks like real media.
///
/// Bilibili's CDN serves m4s segments as `application/octet-stream` or
/// `video/*`. When a stream URL is gated or expired it instead returns a
/// short JSON or text error body with HTTP 200. Rejecting those makes the
/// download fail fast as `ERR::INVALID_MEDIA_RESPONSE` instead of writing
/// the error payload to disk. A missing content-type header is treated as
/// valid to preserve existing behavior for CDNs that omit it.
pub(crate) fn is_media_content_type(ct: Option<&reqwest::header::HeaderValue>) -> bool {
    let Some(ct) = ct.and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let lower = ct.to_ascii_lowercase();
    !(lower.contains("application/json") || lower.starts_with("text/"))
}
