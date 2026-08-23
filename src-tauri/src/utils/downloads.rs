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
        MAX_CDN_LOOPS, MIN_MEDIA_BYTES, MIN_SPEED_THRESHOLD, REFERER, SEGMENT_STALL_TIMEOUT_SECS,
        SPEED_CHECK_INTERVAL_SECS, USER_AGENT,
    },
    emits::Emits,
    handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY,
    utils::cdn_selector,
};

/// Error type for segment download failures.
#[derive(Debug)]
enum SegmentError {
    // Why: split from Reconnect because both fed one shared rotation budget,
    //   so a globally slow CDN could burn the whole budget on SLOW rotations
    //   and leave nothing to recover the stream errors that follow — a
    //   segment then failed while it was still downloadable, just slowly
    //   (seen in the v1.49.0 pre-release test: 35 segments dead after SLOW
    //   consumed 6/6 rotations, then "error decoding response body" hit).
    // Why: resume is now restricted to SAME-CDN stream-error retries.
    //   Cross-CDN resume (rotating on SLOW then continuing from the bytes
    //   already received) produced byte-count-correct but content-corrupt
    //   files: Bilibili CDN mirrors can serve a different byte stream for
    //   the same path (edge sync lag), so the 206 + Content-Range checks
    //   all pass while the payload itself differs across CDNs. Stitching
    //   CDN #0 bytes then CDN #1 bytes broke the moov atom (v1.49.0
    //   pre-release test: goi3.mp4 verified corrupt, goi2.mp4 with zero
    //   rotations verified fine). Bili23-Downloader avoids this by never
    //   switching CDN mid-download.
    /// Throughput below MIN_SPEED_THRESHOLD; rotate using the slow-speed
    /// budget (separate from the stream-error budget of Reconnect). The
    /// caller fully restarts the segment — resuming on another CDN is unsafe.
    Slow,
    /// Body stream broke mid-transfer (connection reset, decode error).
    /// Carries the bytes already received in this attempt so the caller can
    /// retry the SAME CDN from where it broke; once that budget runs out it
    /// rotates CDN and fully restarts the segment.
    Reconnect(u64),
    // Why: introduced with inline disk writes (Plan B: chunks stream straight to
    //   disk, write_segment removed) — a disk failure now happens mid-stream
    //   inside download_segment_stream, so it needs a non-rotatable
    //   variant; otherwise it would ride Reconnect and burn the CDN rotation
    //   budget on an environmental error (ENOSPC) that rotation can't fix
    //   (task: dl-perf).
    /// Unrecoverable disk write failure (e.g. ENOSPC → ERR::DISK_FULL).
    /// Not CDN-specific, so the caller fails the download rather than rotate.
    DiskError(anyhow::Error),
}

use anyhow::Result;
use futures::stream::FuturesUnordered;
use futures::StreamExt;
use reqwest::header;
use reqwest::RequestBuilder;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;
use tokio::{fs, io::AsyncSeekExt, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// Builds the shared reqwest::Client for downloads with connection pooling
/// tuned for parallel segment fetches (see inline comments for each option).
/// Centralized here so the shared client (lib.rs) and the fallback client
/// (download_url) stay identical without manual mirroring.
pub fn build_download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        // Overall request timeout. CDN rotation handles truly stuck
        // transfers.
        .timeout(Duration::from_secs(120))
        // Separate handshake timeout so a hung connect fails fast (10s) and
        // rotates to the next CDN, instead of burning the full 120s budget.
        .connect_timeout(Duration::from_secs(10))
        // Fixed at the max segment concurrency (8). The pool is just a
        // cache; sizing to the max means runtime changes to
        // downloadParallelism take effect immediately without rebuilding
        // the client or restarting the app.
        // Constraint: the literal 8 is maintenance-coupled to the max clamp
        //   in Settings::resolve_segment_concurrency
        //   (src/models/settings.rs: both the `unwrap_or(8)` default and the
        //   `_ => 8` match arm). There is no shared named constant, so if the
        //   allowed max step ever changes, bump this in lockstep or the pool
        //   will under-provision at peak parallelism.
        .pool_max_idle_per_host(8)
        // Keep idle connections alive longer than reqwest's 90s default so
        // they're reused across gaps between segment fetches. Safe to
        // extend because tcp_keepalive evicts dead peers.
        .pool_idle_timeout(Duration::from_secs(120))
        // Probe idle connections so half-open/dead CDN sockets are
        // detected and reused connections don't fail mid-request.
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .expect("Failed to build HTTP client")
}

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

/// Maps an I/O error to a [`SegmentError::DiskError`], translating ENOSPC
/// to `ERR::DISK_FULL` via [`map_io_error`]. Used at each disk write/seek/flush
/// site in [`download_segment_stream`].
fn to_segment_disk_error(e: std::io::Error) -> SegmentError {
    SegmentError::DiskError(map_io_error(e))
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
pub(crate) fn apply_cookie(mut req: RequestBuilder, cookie: &Option<String>) -> RequestBuilder {
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

/// Resolves the cancellation token for a download from the registry.
///
/// Why: the registry drops tokens on cancel (to stay idempotent), so a
///   download can still reach this point after the user cancelled — e.g. a
///   retry attempt that started during a backoff sleep, or a playurl fetch
///   that was in flight when cancel arrived. When the token is absent the
///   pre-cancel flag is consulted so the cancellation is detected here
///   instead of running the download to completion.
async fn resolve_cancel_token(
    ctx: &str,
    download_id: &Option<String>,
) -> Result<Option<CancellationToken>> {
    let Some(id) = download_id else {
        return Ok(None);
    };
    match DOWNLOAD_CANCEL_REGISTRY.get_token(id).await {
        Some(t) => Ok(Some(t)),
        None => {
            if DOWNLOAD_CANCEL_REGISTRY.is_cancelled(id).await {
                log::info!("[BE] {}: token absent but pre-cancelled: id={}", ctx, id);
                return Err(anyhow::anyhow!("ERR::CANCELLED"));
            }
            Ok(None)
        }
    }
}

/// Per-segment shared state consumed by the aggregate speed monitor.
///
/// Why an aggregate monitor instead of per-segment thresholds: with N
///   parallel segments the local bandwidth splits N ways, so a per-segment
/// threshold of MIN_SPEED_THRESHOLD is effectively divided by N and fires
/// rotations on healthy downloads (observed: 604 slow rotations across 3
/// downloads, ping-ponging between CDNs, each restart discarding up to 32MB).
/// The "is it slow" decision moved to TOTAL throughput; per-segment state
/// now only reports progress and receives rotation requests.
///
/// One instance per segment, shared by `Arc` between the segment task and
/// the monitor task spawned in `download_url`.
struct SegmentStats {
    /// Cumulative bytes received by this segment (never reset — a full
    /// restart keeps counting so monitor deltas stay monotonic).
    bytes: AtomicU64,
    /// Monitor's previous sample snapshot; swapped each tick to compute
    /// this segment's delta without a mutex.
    prev_sample: AtomicU64,
    /// Set by the segment task once it acquires its semaphore permit and
    /// starts streaming. A semaphore-waiting segment has delta == 0 and
    /// would otherwise always win "slowest" without ever being able to
    /// honor the request.
    started: AtomicBool,
    /// Set by the segment task on completion so the monitor stops
    /// considering it as a rotation candidate.
    finished: AtomicBool,
    /// Set when this segment's slow-rotation budget is spent; the monitor
    /// stops selecting it (it must keep streaming slowly — the safety
    /// valve that keeps sub-threshold links converging instead of
    /// rotating forever).
    slow_budget_exhausted: AtomicBool,
    /// Rotation request flag set by the monitor when aggregate throughput
    /// stayed below MIN_SPEED_THRESHOLD and this segment had the smallest
    /// delta. Consumed (cleared) by the segment task.
    rotate_requested: AtomicBool,
}

impl SegmentStats {
    fn new() -> Self {
        Self {
            bytes: AtomicU64::new(0),
            prev_sample: AtomicU64::new(0),
            started: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            slow_budget_exhausted: AtomicBool::new(false),
            rotate_requested: AtomicBool::new(false),
        }
    }
}

/// Picks the slowest rotation-eligible segment index from per-segment deltas.
///
/// `eligible` marks segments that are started, not finished, and still have
/// slow-rotation budget. Ties resolve to the lowest index (deterministic).
/// Returns `None` when no segment is eligible. Pure function — unit-testable.
fn pick_slowest_segment(deltas: &[u64], eligible: &[bool]) -> Option<usize> {
    deltas
        .iter()
        .zip(eligible)
        .enumerate()
        .filter(|(_, (_, &ok))| ok)
        .min_by_key(|(_, (delta, _))| **delta)
        .map(|(idx, _)| idx)
}

/// Caps total CDN rotations at `cdn_urls_len × MAX_CDN_LOOPS`.
///
/// Why: single source of truth shared by the Slow decision, the download_url
///   loop ceiling, and the SLOW warn-log denominator, so the logged
///   "rotation N/M" denominator cannot drift from the real ceiling
///   (task: speed-trace-log).
///
/// Constraint: saturating arithmetic + min-clamp to 255 prevents overflow
///   when `cdn_urls_len` exceeds u8 range (e.g. very large backup URL lists).
fn cdn_rotation_limit(cdn_urls_len: usize) -> u8 {
    (cdn_urls_len.min(255) as u8).saturating_mul(MAX_CDN_LOOPS)
}

/// Extracts the start offset from a `Content-Range: bytes {start}-{end}/{total}` header.
///
/// Returns `None` when the header is missing or unparsable (e.g. the
/// unsatisfied-range form `bytes */{total}`), in which case the caller keeps
/// trusting the response as before.
fn content_range_start(value: &header::HeaderValue) -> Option<u64> {
    let s = value.to_str().ok()?;
    let bytes_spec = s.trim().strip_prefix("bytes ")?.split('/').next()?;
    let start = bytes_spec.split('-').next()?.trim();
    start.parse::<u64>().ok()
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
///    (static P2P demotion + throughput probe) which also recovers the total
///    size.
/// 3. Falls back to [`single_stream_fallback`] when the server does not
///    advertise `Accept-Ranges`/Content-Length.
/// 4. Splits the payload into 8 MB segments (concurrency pinned to 1
///    because Bilibili's CDN is unstable with parallel range requests).
/// 5. Pre-allocates the output file and emits progress updates via
///    [`Emits`] to the frontend.
/// 6. Streams each segment through [`download_segment_stream`] while an
///    aggregate-speed monitor watches TOTAL throughput; when it stays below
///    [`MIN_SPEED_THRESHOLD`] the slowest active segment is asked to rotate
///    (own slow-rotation budget). Mid-transfer stream errors / stalls / size
///    mismatches rotate CDN URLs through a separate rotation budget, rolling
///    back any progress that was already reported for a segment being
///    retried.
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
    host_health: Arc<cdn_selector::HostHealth>,
) -> Result<()> {
    log::info!(
        "[BE] download_url: starting download to {:?}, cdn_count={}",
        output_path.file_name().and_then(|n| n.to_str()),
        1 + backup_urls.as_ref().map(|v| v.len()).unwrap_or(0)
    );

    // Get cancellation token from registry
    let cancel_token = resolve_cancel_token("download_url", &download_id).await?;

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
            Arc::new(build_download_client())
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
    //   candidate CDNs in parallel for throughput instead of reacting to slowness
    //   mid-download (issue #490).
    let cdn_outcome =
        cdn_selector::select_best_cdns(cdn_urls.clone(), cookie.clone(), &host_health).await;

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
    // Why: raised from 8MB now that segments stream straight to disk (no
    //   Vec<u8> buffering), so segment size no longer drives resident memory.
    //   Fewer segment boundaries = fewer CDN-rotation resets and progress
    //   dips. 32MB keeps small (50MB) videos parallelizable (2 segments)
    //   while cutting 1GB from 125 to 32 segments.
    const DEFAULT_SEGMENT_MB: u64 = 32;
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
    let segment_stats: Vec<Arc<SegmentStats>> = segments
        .iter()
        .map(|_| Arc::new(SegmentStats::new()))
        .collect();

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
        let host_health_c = host_health.clone();
        let stats_c = segment_stats[idx].clone();
        futs.push(tokio::spawn(async move {
            let _permit = sem_c.acquire().await.unwrap();

            // Check cancellation before starting segment
            if let Err(e) = check_cancelled(&cancel_token_c) {
                let _ = emits_c.stop().await;
                return Err(e);
            }

            // Mark as started so the aggregate monitor may select this
            // segment as a rotation candidate (semaphore-waiting segments
            // have delta == 0 and must not be picked).
            stats_c.started.store(true, Ordering::Relaxed);

            // `http_retries` counts HTTP-layer failures (invalid status,
            // request error) bounded by MAX_SEG_RETRIES per selected URL;
            // it resets when a request-error exhaustion rotates the CDN.
            // CDN-rotation failures (size mismatch, stream error, connection
            // failure) use `cdn_rotation_count`, slow-speed rotations use
            // `slow_rotations`, and same-CDN resume retries use
            // `same_cdn_retries`. Keeping these budgets independent
            // prevents CDN rotations from inflating the HTTP retry counter —
            // which previously disabled the in-segment chunk-retry budget
            // inside download_segment_stream and produced misleading
            // `attempt 8/3` log lines — and prevents SLOW rotations from
            // starving stream-error recovery (see SegmentError::Slow).
            let mut http_retries: u8 = 0;
            const MAX_SEG_RETRIES: u8 = 3;
            let size = e - s + 1;
            let mut cdn_rotation_count: u8 = 0;
            let max_cdn_rotations: u8 = cdn_rotation_limit(cdn_urls_c.len());
            let mut slow_rotations: u8 = 0;
            let max_slow_rotations: u8 = cdn_rotation_limit(cdn_urls_c.len());
            let mut same_cdn_retries: u8 = 0;
            const MAX_SAME_CDN_RETRIES: u8 = 2;
            // Track bytes this segment has added to dl_total_c
            // for rollback on retry
            let seg_bytes_added = Arc::new(AtomicU64::new(0));
            // Resume cursor for same-CDN stream-error retries only. Any CDN
            // change (SLOW rotation, error rotation, size mismatch) fully
            // restarts the segment instead — see SegmentError for why
            // cross-CDN resume corrupts files.
            let mut seg_start = s;
            // Segment bytes remaining for the same-CDN resume path
            let mut seg_remaining = size;
            // Set by the error arms that must discard everything received so
            // far; handled once at the top of the next loop iteration.
            let mut needs_full_restart = false;

            loop {
                // Check cancellation on each iteration
                if let Err(e) = check_cancelled(&cancel_token_c) {
                    let _ = emits_c.stop().await;
                    return Err(e);
                }

                if needs_full_restart {
                    needs_full_restart = false;
                    // Roll back ALL bytes this segment has counted so far:
                    // the next attempt rewrites the whole [s, e] range.
                    let prev = seg_bytes_added.swap(0, Ordering::Relaxed);
                    if prev > 0 {
                        let new_total =
                            dl_total_c.fetch_sub(prev, Ordering::Relaxed) - prev;
                        emits_c.update_progress(new_total);
                    }
                    seg_start = s;
                    seg_remaining = size;
                }

                // Select CDN URL from the combined rotation count of both
                // budgets so each rotation still advances to the next CDN.
                // The rotation-time substitution layer then rewrites the
                // URL when its host is marked unhealthy in this download —
                // covering pools whose every URL lives on the same dead
                // host, where index rotation alone cannot escape (issue #527).
                let rotations_used = cdn_rotation_count as usize + slow_rotations as usize;
                let cdn_idx = rotations_used % cdn_urls_c.len();
                let selected_url = &cdn_urls_c[cdn_idx];
                let effective_url = cdn_selector::resolve_effective_url(
                    selected_url,
                    &host_health_c.snapshot(),
                    rotations_used,
                );
                if &effective_url != selected_url {
                    log::info!(
                        "[BE] download_url: segment {} substituting unhealthy host: {} -> {}",
                        idx,
                        cdn_selector::extract_host(selected_url).unwrap_or_default(),
                        cdn_selector::extract_host(&effective_url).unwrap_or_default()
                    );
                }
                let current_url = &effective_url;

                let req = apply_cookie(
                    client_c
                        .get(current_url)
                        .header(header::RANGE, format!("bytes={}-{}", seg_start, e))
                        .header(header::REFERER, REFERER),
                    &cookie_c,
                );
                match req.send().await {
                    Ok(mut resp) => {
                        // Validate response status
                        // Why: a plain 200 is trusted only when it starts at
                        //   byte 0 and its Content-Length equals the full
                        // segment — a 200 body always begins at offset 0, so
                        //   mid-resume (seg_start > 0) writing it at seg_start
                        //   would shift every byte and corrupt the file.
                        let is_valid_response = resp.status() == 206
                            || (seg_start == 0
                                && resp.status() == 200
                                && seg_remaining == resp.content_length().unwrap_or(seg_remaining));

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

                        // Resume safety: verify the server honored the Range
                        // start. Some Bilibili CDN mirrors answer 206 with a
                        // DIFFERENT Content-Range start than requested
                        // (clamped to 0 or own chunk alignment). Writing that
                        // body at `seg_start` shifts all subsequent bytes and
                        // silently corrupts the file: byte counts still add
                        // up so the final size check passes, yet the merged
                        // mp4 lost its moov atom (v1.49.0 pre-release test,
                        // goi.mp4).
                        if let Some(cr) = resp.headers().get(header::CONTENT_RANGE) {
                            if let Some(actual_start) = content_range_start(cr) {
                                if actual_start != seg_start {
                                    log::warn!(
                                        "[BE] download_url: segment {} CDN ignored Range start: requested {}, got {} (cdn_idx={})",
                                        idx,
                                        seg_start,
                                        actual_start,
                                        cdn_idx
                                    );
                                    // Full restart; nothing was received from
                                    // this response yet, so the rollback in
                                    // needs_full_restart handling is a no-op.
                                    needs_full_restart = true;
                                    if cdn_rotation_count >= max_cdn_rotations {
                                        log::warn!(
                                            "[BE] download_url: segment {} CDN rotation budget exhausted after bad Content-Range ({}/{}, cdn_idx={})",
                                            idx,
                                            cdn_rotation_count,
                                            max_cdn_rotations,
                                            cdn_idx
                                        );
                                        return Err(anyhow::anyhow!(
                                            "segment {} bad content-range after CDN rotation budget exhausted",
                                            idx
                                        ));
                                    }
                                    cdn_rotation_count += 1;
                                    backoff_sleep(cdn_rotation_count).await;
                                    continue;
                                }
                            }
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
                        let stats_cb = stats_c.clone();
                        let download_result = download_segment_stream(
                            &mut resp,
                            idx,
                            cdn_idx,
                            seg_start,
                            &path_c,
                            &stats_cb,
                            |chunk_len| {
                                seg_bytes_cb.fetch_add(chunk_len, Ordering::Relaxed);
                                stats_cb.bytes.fetch_add(chunk_len, Ordering::Relaxed);
                                let new_total =
                                    dl_total_cb.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len;
                                emits_cb.update_progress(new_total);
                            },
                        )
                        .await;

                        let received = match download_result {
                            Ok(received) => received,
                            Err(SegmentError::DiskError(e)) => {
                                log::error!(
                                    "[BE] download_url: segment {} disk write failed: {}",
                                    idx,
                                    e
                                );
                                return Err(e);
                            }
                            Err(SegmentError::Slow) => {
                                // Slow-speed rotations draw from their own
                                // budget: the monitor only selects segments
                                // that still have budget (slow_budget_exhausted),
                                // so a request arriving here is always within
                                // budget. When the budget is spent, the flag
                                // makes the monitor stop selecting this
                                // segment — it keeps streaming slowly, the
                                // same safety valve the old per-segment
                                // check_download_speed had, so sub-threshold
                                // links still converge instead of rotating
                                // forever.
                                // No backoff: waiting does not raise CDN
                                // throughput.
                                // Full restart, not resume: the next CDN may
                                // serve a different byte stream for the same
                                // path (see SegmentError::Slow).
                                let next_cdn_idx = (rotations_used + 1) % cdn_urls_c.len();
                                log::info!(
                                    "[BE] download_url: segment {} rotating CDN #{} → #{} due to slow speed, restarting segment (slow rotation {}/{})",
                                    idx,
                                    cdn_idx,
                                    next_cdn_idx,
                                    slow_rotations + 1,
                                    max_slow_rotations
                                );
                                needs_full_restart = true;
                                slow_rotations += 1;
                                if slow_rotations >= max_slow_rotations {
                                    log::warn!(
                                        "[BE] download_url: segment {} slow-rotation budget exhausted, will keep streaming on the current CDN",
                                        idx
                                    );
                                    stats_c
                                        .slow_budget_exhausted
                                        .store(true, Ordering::Relaxed);
                                }
                                continue;
                            }
                            Err(SegmentError::Reconnect(received)) => {
                                // Stream broke mid-transfer. When every
                                // expected byte had already arrived before the
                                // break (trailing reset / bad chunked
                                // trailer), the segment is complete on disk:
                                // finish instead of resuming past `e`, which
                                // would send a start > end Range (always 416)
                                // and fail an already-complete segment.
                                if received == seg_remaining {
                                    stats_c.finished.store(true, Ordering::Relaxed);
                                    return Ok(());
                                }
                                // First try resuming the SAME CDN from where it
                                // broke: connection resets are usually
                                // link-level, the CDN's own bytes stay
                                // consistent, and no traffic is wasted. Only
                                // after MAX_SAME_CDN_RETRIES do we rotate —
                                // and a rotation discards everything received
                                // so far because the next CDN may serve
                                // different bytes for the same path (see
                                // SegmentError for the corruption case).
                                if same_cdn_retries < MAX_SAME_CDN_RETRIES {
                                    same_cdn_retries += 1;
                                    log::info!(
                                        "[BE] download_url: segment {} retrying same CDN #{} after stream error, resuming at +{} bytes (same-CDN retry {}/{})",
                                        idx,
                                        cdn_idx,
                                        received,
                                        same_cdn_retries,
                                        MAX_SAME_CDN_RETRIES
                                    );
                                    seg_start += received;
                                    seg_remaining = seg_remaining.saturating_sub(received);
                                    backoff_sleep(same_cdn_retries).await;
                                    continue;
                                }
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
                                // Switch to next CDN URL (loops back to start)
                                let next_cdn_idx = (rotations_used + 1) % cdn_urls_c.len();
                                log::info!(
                                    "[BE] download_url: segment {} rotating CDN #{} → #{} after stream error, restarting segment (rotation {}/{})",
                                    idx,
                                    cdn_idx,
                                    next_cdn_idx,
                                    cdn_rotation_count + 1,
                                    max_cdn_rotations
                                );
                                needs_full_restart = true;
                                cdn_rotation_count += 1;
                                backoff_sleep(cdn_rotation_count).await;
                                continue;
                            }
                        };

                        // Verify size
                        if received != seg_remaining {
                            // Size mismatch typically indicates CDN edge cache
                            // corruption or rate-limit cutoff. Rotate to a
                            // different CDN immediately instead of retrying
                            // the same node, which tends to reproduce the
                            // same truncated response. The received bytes may
                            // be corrupt, so restart the whole segment and
                            // roll back all of this segment's progress.
                            needs_full_restart = true;
                            if cdn_rotation_count < max_cdn_rotations {
                                log::warn!(
                                    "[BE] download_url: segment {} size mismatch: expected {}, got {} (cdn rotation {}/{}, cdn_idx={})",
                                    idx,
                                    seg_remaining,
                                    received,
                                    cdn_rotation_count + 1,
                                    max_cdn_rotations,
                                    cdn_idx
                                );
                                let next_cdn_idx = (rotations_used + 1) % cdn_urls_c.len();
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

                        // Segment complete — retire it from monitor rotation
                        // candidacy.
                        stats_c.finished.store(true, Ordering::Relaxed);

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
                        // Connection-establishment failures exhausted this
                        // URL's retries: host-level evidence, not a bad
                        // signature — mark the host unhealthy for the rest of
                        // this download and rotate away instead of failing the
                        // segment (issue #527). Rotations draw from the shared
                        // cdn_rotation_count budget; http_retries resets so
                        // the next selected URL keeps its full retry value.
                        host_health_c.mark_url_unhealthy(current_url);
                        // Note: the mark is recorded BEFORE the rotation
                        // budget check below — even when the budget is
                        // exhausted and this segment fails, the next
                        // retry_download attempt's pre-selection
                        // substitutes away from this host, because a
                        // playurl refetch can keep returning it (issue #527).
                        if cdn_rotation_count < max_cdn_rotations {
                            needs_full_restart = true; // CDN change => full restart (byte-stream rule)
                            cdn_rotation_count += 1;
                            http_retries = 0;
                            backoff_sleep(cdn_rotation_count).await;
                            continue;
                        }
                        return Err(anyhow::anyhow!("segment {} request error: {e}", idx));
                    }
                }
            }
        }));
    }

    // ---- 5b. Aggregate speed monitor ----
    // Timer-driven (not chunk-callback-driven), so it also detects a full
    // stall where no chunk ever arrives. When TOTAL throughput stays below
    // MIN_SPEED_THRESHOLD for two consecutive samples, the slowest active
    // segment is asked to rotate — one segment per verdict, so healthy
    // segments keep their connections. Per-segment speed thresholds were
    // removed because parallel segments split the local bandwidth and made
    // every segment look slow (see `SegmentStats`).
    let stats_for_monitor = segment_stats.clone();
    let monitor = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(SPEED_CHECK_INTERVAL_SECS));
        interval.tick().await; // discard the immediate first tick (warm-up)
        let mut last_sample = Instant::now();
        let mut consecutive_slow: u32 = 0;
        loop {
            interval.tick().await;
            let now = Instant::now();
            // Floor at 1s: interval ticks can fire slightly early under
            // timer coalescing, and a zero divisor would panic.
            let elapsed = now.duration_since(last_sample).as_secs().max(1);
            last_sample = now;

            let mut deltas = Vec::with_capacity(stats_for_monitor.len());
            let mut total_delta: u64 = 0;
            for s in &stats_for_monitor {
                let cur = s.bytes.load(Ordering::Relaxed);
                let prev = s.prev_sample.swap(cur, Ordering::Relaxed);
                let d = cur.saturating_sub(prev);
                total_delta += d;
                deltas.push(d);
            }
            let bps = total_delta / elapsed;
            log::info!(
                "[BE] download_url: aggregate speed {} KiB/s over {}s",
                bps / 1024,
                elapsed
            );

            if bps >= MIN_SPEED_THRESHOLD {
                consecutive_slow = 0;
                continue;
            }
            consecutive_slow += 1;
            if consecutive_slow < 2 {
                continue;
            }
            // Rotation candidates: started (not semaphore-waiting), not
            // finished, and still holding slow-rotation budget.
            let eligible: Vec<bool> = stats_for_monitor
                .iter()
                .map(|s| {
                    s.started.load(Ordering::Relaxed)
                        && !s.finished.load(Ordering::Relaxed)
                        && !s.slow_budget_exhausted.load(Ordering::Relaxed)
                })
                .collect();
            let Some(slowest) = pick_slowest_segment(&deltas, &eligible) else {
                continue;
            };
            // compare_exchange skips a segment already consuming a previous
            // request — its rotation is still in flight.
            if stats_for_monitor[slowest]
                .rotate_requested
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                log::warn!(
                    "[BE] download_url: aggregate speed {} KiB/s below threshold {} KiB/s for {} samples, requesting rotation of slowest segment {} ({} bytes in window)",
                    bps / 1024,
                    MIN_SPEED_THRESHOLD / 1024,
                    consecutive_slow,
                    slowest,
                    deltas[slowest]
                );
            }
        }
    });

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
                    monitor.abort();
                    return Err(e);
                }
                seg_errors += 1;
            }
            Err(_) => seg_errors += 1,
        }
    }
    monitor.abort();

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

/// Streams one segment straight to disk, honoring monitor rotation requests
/// and a per-chunk stall timeout.
///
/// Chunks are written directly to the pre-allocated file at `pos` (no in-memory
/// segment buffer), so segment size does not bound resident memory. There is
/// no per-segment speed threshold here: the aggregate-speed monitor in
/// `download_url` decides slowness from TOTAL throughput (see
/// [`SegmentStats`]) and requests a rotation via `stats.rotate_requested`.
/// A fully stalled stream (no chunk within [`SEGMENT_STALL_TIMEOUT_SECS`])
/// is detected by a per-chunk timeout instead of a threshold.
///
/// # Arguments
///
/// * `resp` - Mutable reference to the HTTP response to read from
/// * `idx` - Segment index, used in trace/warn logs for per-segment identification
/// * `cdn_idx` - Index of the current CDN in `cdn_urls`, used in rotation logs
/// * `pos` - Absolute byte offset where the segment is written in `path`
/// * `path` - Pre-allocated output file path (written via random-access seek)
/// * `stats` - This segment's shared stats: receives byte counts, rotation
///   requests
/// * `on_chunk_received` - Callback invoked when each chunk is received
///
/// # Returns
///
/// - `Ok(received)`: Download complete; bytes streamed to `path` at `pos`,
///   `received` is the total bytes written.
/// - `Err(SegmentError::Slow)`: The aggregate-speed monitor flagged TOTAL
///   throughput below [`MIN_SPEED_THRESHOLD`] and selected this segment;
///   the caller rotates CDN and fully restarts the segment.
/// - `Err(SegmentError::Reconnect(received))`: The body stream broke
///   mid-transfer (connection reset, decoding error) or stalled for
///   [`SEGMENT_STALL_TIMEOUT_SECS`]. The caller first retries the SAME CDN
///   resuming at `pos + received`; after that budget runs out it rotates CDN
///   and fully restarts the segment.
/// - `Err(SegmentError::DiskError(e))`: Unrecoverable disk write failure
///   (e.g. ENOSPC → ERR::DISK_FULL); the caller fails the download.
#[allow(clippy::too_many_arguments)]
async fn download_segment_stream(
    resp: &mut reqwest::Response,
    idx: usize,
    cdn_idx: usize,
    pos: u64,
    path: &Path,
    stats: &SegmentStats,
    on_chunk_received: impl Fn(u64),
) -> Result<u64, SegmentError> {
    // Stream chunks straight to the pre-allocated file at `pos` instead of
    // buffering the whole segment in memory. On Reconnect the caller first
    // resumes at `pos + received` on the same CDN (bytes already written stay
    // valid); only a CDN rotation fully restarts the segment from `pos`,
    // overwriting partial bytes — the final successful attempt always ends up
    // covering the whole range, so no half-written segment survives.
    // Constraint: open mode must stay write-only — no create/truncate. The file
    //   is pre-allocated once by preallocate_file and shared by up to
    //   `concurrency` segment writers, each owning its own byte range;
    //   truncate(true) would zero the file and destroy other segments' data.
    //   single_stream_fallback's create+truncate is safe only because it is the
    //   sole sequential owner of the whole file.
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(to_segment_disk_error)?;
    file.seek(std::io::SeekFrom::Start(pos))
        .await
        .map_err(to_segment_disk_error)?;
    let mut received: u64 = 0;

    loop {
        // Per-chunk stall timeout: a connection that delivers nothing for
        // SEGMENT_STALL_TIMEOUT_SECS is treated like a broken stream and
        // routed through Reconnect recovery. This is the only in-segment
        // liveness check — chunk callbacks cannot detect a full stall, so
        // without this the segment would hang until the 120s whole-request
        // timeout.
        let chunk_result = tokio::time::timeout(
            Duration::from_secs(SEGMENT_STALL_TIMEOUT_SECS),
            resp.chunk(),
        )
        .await;
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(_) => {
                log::warn!(
                    "[BE] download_segment: segment {} CDN #{} stalled: no chunk for {}s after {} bytes",
                    idx,
                    cdn_idx,
                    SEGMENT_STALL_TIMEOUT_SECS,
                    received
                );
                return Err(SegmentError::Reconnect(received));
            }
        };
        match chunk {
            Ok(Some(chunk)) => {
                let chunk_len = chunk.len() as u64;
                received += chunk_len;
                file.write_all(&chunk)
                    .await
                    .map_err(to_segment_disk_error)?;

                // Report progress on chunk received
                on_chunk_received(chunk_len);

                // Honor a monitor rotation request: consume the flag and
                // surface as Slow so the caller rotates CDN with the
                // slow-speed budget and fully restarts the segment.
                if stats
                    .rotate_requested
                    .compare_exchange(true, false, Ordering::Relaxed, Ordering::Relaxed)
                    .is_ok()
                {
                    log::info!(
                        "[BE] download_segment: segment {} CDN #{} honoring aggregate-slow rotation request after {} bytes",
                        idx,
                        cdn_idx,
                        received
                    );
                    return Err(SegmentError::Slow);
                }
            }
            Ok(None) => break,
            Err(e) => {
                // Chunk-stream error (e.g. connection reset, decoding error).
                // The stream is broken, so retrying chunk() on the same
                // response cannot recover — return the bytes received so far
                // and let the caller's download_url loop recover: it resumes
                // the SAME CDN from `pos + received` first, and only rotates
                // to the next CDN URL (fully restarting the segment) after
                // that budget runs out.
                // Why: all chunk() errors map to Reconnect rather than only
                //   "decoding" ones, because classifying via reqwest's error
                //   message string is fragile across versions (issue #494).
                log::warn!(
                    "[BE] download_segment: stream error after {} bytes: {}",
                    received,
                    e
                );
                return Err(SegmentError::Reconnect(received));
            }
        }
    }

    file.flush().await.map_err(to_segment_disk_error)?;
    Ok(received)
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
    let cancel_token = resolve_cancel_token("single_stream_fallback", &download_id).await?;

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
/// Sleep durations double per attempt, capped at 1500 ms:
/// 200 ms (attempt 1), 400 ms (attempt 2), 800 ms (attempt 3), 1500 ms
/// (attempt 4+). Used between segment download retries to throttle
/// reconnection attempts to unstable CDN nodes.
///
/// # Arguments
///
/// * `attempt` - 1-indexed retry attempt number
async fn backoff_sleep(attempt: u8) {
    // Cap at 1500ms: 200ms (attempt 1), 400ms (attempt 2), 800ms (attempt 3),
    //   1500ms (attempt 4+). Tighter than the prior 500/1000/2000 cap: CDN
    //   under throughput swings and long backoffs dominate wall-clock
    //   (observed: 291 rotations on an 88MB download, task: speed-trace-log).
    let ms = (200u64 << attempt.saturating_sub(1)).min(1500);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_slowest_active_segment() {
        let deltas = [500u64, 400, 0, 200];
        let eligible = [true, true, false, true];
        // Index 2 has the smallest delta but is ineligible, so index 3 wins.
        assert_eq!(pick_slowest_segment(&deltas, &eligible), Some(3));
    }

    #[test]
    fn picks_slowest_ties_resolve_to_lowest_index() {
        let deltas = [0u64, 0, 0];
        let eligible = [true, true, true];
        assert_eq!(pick_slowest_segment(&deltas, &eligible), Some(0));
    }

    #[test]
    fn picks_slowest_none_when_all_finished() {
        assert_eq!(pick_slowest_segment(&[1, 2], &[false, false]), None);
    }

    #[test]
    fn parses_content_range_start() {
        let ok = header::HeaderValue::from_static("bytes 123-456/789");
        assert_eq!(content_range_start(&ok), Some(123));
        let zero = header::HeaderValue::from_static("bytes 0-0/1");
        assert_eq!(content_range_start(&zero), Some(0));
        // Unsatisfied-range form and garbage return None (caller skips check)
        let unsat = header::HeaderValue::from_static("bytes */789");
        assert_eq!(content_range_start(&unsat), None);
        let junk = header::HeaderValue::from_static("items 1-2");
        assert_eq!(content_range_start(&junk), None);
    }
}
