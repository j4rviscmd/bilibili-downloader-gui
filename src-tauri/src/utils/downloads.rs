//! HTTP Download Utilities
//!
//! This module provides robust HTTP download functionality with support for:
//! - Segmented parallel downloads with Range requests
//! - Automatic retry with backoff
//! - Progress tracking and emission to frontend
//! - Disk space checking
//! - Fallback to single-stream download when Range is not supported
//! - Download cancellation support

use crate::handlers::concurrency::{SpeedLimiter, DOWNLOAD_SPEED_LIMITER};
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
    //   rotations verified fine). The safe designs are either never
    //   switching CDN mid-download, or discarding all received bytes on
    //   every CDN change — this codebase chose the latter so it can still
    //   rotate away from a degraded node.
    /// Throughput below MIN_SPEED_THRESHOLD; recovery draws from the
    /// slow-speed budget (separate from the stream-error budget of
    /// Reconnect). Carries the bytes already received in this attempt so
    /// the caller can first resume the SAME CDN with a fresh connection
    /// (rate shapers throttle by connection age, not by CDN — fresh
    /// connections re-accelerate even on the same host); once that budget
    /// runs out it rotates CDN and fully restarts the segment, because
    /// resuming on ANOTHER CDN is unsafe (byte-stream mismatch).
    Slow(u64),
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
    // Why: the chunk-receive loop used to stream a whole 32MB segment to
    //   completion after the user cancelled (observed 47s lag, issue #562) —
    //   cancel was only checked at segment start, segment retry, and
    //   download_url entry, so the gap could span an entire attempt including
    //   same-CDN resume retries. Non-rotatable like DiskError: no CDN or
    //   resume recovery may follow a user-initiated cancel.
    /// Download cancellation observed mid-stream (issue #562). The caller
    /// fails the download with `ERR::CANCELLED` immediately.
    Cancelled,
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
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Semaphore;
use tokio::{fs, io::AsyncSeekExt, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// Maximum same-CDN resume attempts per segment on the aggregate-slow path.
///
/// Why a separate budget: `same_cdn_retries` (stream errors) and
/// `slow_rotations` (CDN rotations) are deliberately independent so one
/// failure class cannot starve the other (see the budget comments in the
/// segment loop). Slow-speed resumes draw from their own budget for the
/// same reason. Three attempts cover the observed re-throttle pattern
/// (fresh connection re-accelerates, then decays again after a few
/// seconds) while still escaping a genuinely throttled node.
const MAX_SLOW_RESUMES: u8 = 3;

/// Minimum bytes a segment attempt must have received before a same-CDN
/// resume is worth one unit of the slow-resume budget.
///
/// Why: a fresh connection re-accelerates only when the THROTTLED
/// connection is the problem. A Slow verdict with almost zero received
/// bytes (observed 2026-08-31 19:22 log: +15 KiB and +7 KiB, both right
/// after a stream-error reconnect) means the connection is already fresh
/// and still dead — the node/path is the bottleneck, so rotating CDN is
/// the correct move and a resume would just burn budget.
const SLOW_RESUME_MIN_BYTES: u64 = 1024 * 1024;

/// Bytes re-fetched and compared before every same-CDN resume.
///
/// Why: "same host = same byte stream" is NOT guaranteed — DNS rotation /
/// connection pooling can land a new connection on a different CDN edge,
/// and edges can serve different versions of the same path (sync lag).
/// Stitching bytes from two versions corrupts the file with byte counts
/// still matching every size check (v1.49.0 goi3.mp4, and the 2026-08-31
/// 19:48 "低速テスト3" download: 7 segments reconnecting simultaneously
/// after a network drop, video stream corrupt from a mid-file stitch).
/// Re-fetching the tail bytes already on disk and comparing them proves
/// the edge still serves the same stream before the resume stitches onto
/// it. The 64 KiB cost is negligible against a segment-sized re-download.
const SAME_STREAM_VERIFY_BYTES: u64 = 64 * 1024;

/// Same-CDN full restarts allowed after a tail-verification rejection.
///
/// Why not rotate immediately on rejection: the rejection only proves THIS
/// connection landed on an edge serving a different version — the host may
/// still be fine. A full restart on the same host discards the segment
/// bytes (no stitch, so no corruption risk) WITHOUT consuming the CDN
/// rotation budget, which is what starved segments into "1 segment(s)
/// failed" → whole-file retry (2026-08-31 21:21 download: 5 rejections
/// burned rotation budget, one segment died, 1.5 GB re-downloaded from
/// zero). One restart covers the flapping case; a second rejection means
/// the host itself is unhealthy and the caller rotates for real.
const MAX_TAIL_REJECT_RESTARTS: u8 = 1;

/// Byte range to re-fetch for resume verification: the tail of the bytes
/// already on disk for THIS segment, capped at [`SAME_STREAM_VERIFY_BYTES`].
///
/// Args are the segment's base offset `seg_base` (= `s`) and the on-disk
/// end (`seg_start + received` — the stitch point the resume continues
/// from). The window is `[on_disk_end - len, on_disk_end)`: the bytes
/// immediately before the stitch, which the next attempt appends to.
///
/// Returns `None` when the segment has no on-disk progress yet — nothing
/// to contradict, resume is trivially safe. Pure function — fully
/// unit-testable.
///
/// Why computed from `seg_base`/`on_disk_end` and NOT from `seg_start`
/// alone: `seg_start` is an absolute file offset, so deriving the window
/// as `[seg_start - len, seg_start)` probes bytes from BEFORE this attempt
/// — on a first resume that is the PREVIOUS segment's region (parallel
/// task, possibly a different CDN edge, possibly still sparse zeros from
/// `set_len`), causing false rejections, and for segment 0 it disabled
/// verification entirely (len clamped to 0). The stitch-adjacent bytes of
/// THIS attempt were never compared (caught in review, 2026-08-31).
fn resume_verify_range(seg_base: u64, on_disk_end: u64) -> Option<(u64, u64)> {
    let len = on_disk_end
        .saturating_sub(seg_base)
        .min(SAME_STREAM_VERIFY_BYTES);
    if len == 0 {
        return None;
    }
    Some((on_disk_end - len, len))
}

/// Verifies the CDN still serves the same byte stream before a same-CDN
/// resume: re-fetches [`resume_verify_range`] from `url` and compares it
/// with the bytes already written to disk.
///
/// Any mismatch, non-206 response, wrong Content-Range start, wrong body
/// length, or I/O failure returns `false` — the caller must fully restart
/// the segment instead of stitching, because a mismatch proves the new
/// connection landed on an edge serving a different version of the file.
async fn verify_resume_tail(
    client: &reqwest::Client,
    url: &str,
    cookie: &Option<String>,
    path: &Path,
    seg_base: u64,
    on_disk_end: u64,
) -> bool {
    let Some((verify_start, verify_len)) = resume_verify_range(seg_base, on_disk_end) else {
        // No on-disk progress in this segment yet — no stitch point,
        // resume is trivially safe.
        return true;
    };

    // Read the bytes already on disk for the same range.
    let mut disk = vec![0u8; verify_len as usize];
    let read_ok = match tokio::fs::File::open(path).await {
        Ok(mut f) => {
            use tokio::io::AsyncReadExt;
            f.seek(std::io::SeekFrom::Start(verify_start)).await.is_ok()
                && f.read_exact(&mut disk).await.is_ok()
        }
        Err(_) => false,
    };
    if !read_ok {
        log::warn!(
            "[BE] verify_resume_tail: failed reading disk bytes at {}..{}",
            verify_start,
            verify_start + verify_len
        );
        return false;
    }

    let req = apply_cookie(
        client
            .get(url)
            .header(
                header::RANGE,
                format!("bytes={}-{}", verify_start, verify_start + verify_len - 1),
            )
            .header(header::REFERER, REFERER)
            .timeout(Duration::from_secs(SEGMENT_STALL_TIMEOUT_SECS)),
        cookie,
    );
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[BE] verify_resume_tail: request failed: {e}");
            return false;
        }
    };
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        log::warn!(
            "[BE] verify_resume_tail: expected 206, got {}",
            resp.status()
        );
        return false;
    }
    match resp.headers().get(header::CONTENT_RANGE) {
        Some(cr) if content_range_start(cr) == Some(verify_start) => {}
        other => {
            log::warn!(
                "[BE] verify_resume_tail: bad Content-Range {:?}",
                other.and_then(|v| v.to_str().ok())
            );
            return false;
        }
    }
    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[BE] verify_resume_tail: body read failed: {e}");
            return false;
        }
    };
    if body.len() as u64 != verify_len || body.as_ref() != disk.as_slice() {
        log::warn!("[BE] verify_resume_tail: tail bytes differ (edge serving a different stream)");
        return false;
    }
    true
}

/// Recovery decision for the aggregate-slow path (`SegmentError::Slow`).
#[derive(Debug, PartialEq, Eq)]
enum SlowAction {
    /// Every expected byte already arrived before the rotation request was
    /// consumed — the segment is complete, finish it.
    Complete,
    /// Reconnect the SAME CDN with a fresh connection and resume from the
    /// received offset; the received bytes already on disk stay valid.
    ResumeSameCdn,
    /// Same-CDN resume budget spent (the CDN itself is the bottleneck):
    /// rotate to the next CDN URL and fully restart the segment.
    RotateCdn,
}

/// Decides the recovery step after the aggregate-speed monitor flagged this
/// segment slow. Pure function — fully unit-testable.
///
/// Order matters: a fully-received segment must finish (a resume past `e`
/// sends `start > end` and always 416s), and same-CDN resume is tried
/// before a byte-discarding CDN rotation because the observed slowdown is
/// per-connection, not per-CDN (fresh connections re-accelerate on the
/// same host — 2026-08-31 52MB download log: every reconnect, cross-CDN or
/// not, jumped to 3–6 MB/s before decaying again). A resume is only worth
/// its budget when the current attempt actually delivered bytes — see
/// [`SLOW_RESUME_MIN_BYTES`].
fn decide_slow_action(received: u64, seg_remaining: u64, slow_resumes: u8) -> SlowAction {
    // `>=` not `==`: an over-delivering edge (Range-ignoring, seen before —
    // see the Content-Range start check) must complete, not fall through to
    // a subtraction that underflows.
    if received >= seg_remaining {
        return SlowAction::Complete;
    }
    if slow_resumes < MAX_SLOW_RESUMES && received >= SLOW_RESUME_MIN_BYTES {
        return SlowAction::ResumeSameCdn;
    }
    SlowAction::RotateCdn
}

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

/// Per-request timeout override while a speed limit is active (issue #421).
///
/// Why a fixed large cap instead of `bytes / limit` arithmetic: the
/// aggregate limit is shared by up to `concurrency` parallel segments, so
/// ONE segment's wall time spans up to the WHOLE download's paced duration
/// (e.g. 8 x 32 MiB at 100 KB/s total ≈ 45 min per segment). Any
/// per-segment formula underestimates that and reintroduces the
/// timeout-reconnect churn this override exists to remove. A large fixed
/// cap is safe because liveness is owned by the 10s per-chunk stall
/// detector (SEGMENT_STALL_TIMEOUT_SECS), which a paced-but-flowing stream
/// never trips — chunks keep arriving from kernel/hyper buffers during
/// other tasks' pacing sleeps.
const LIMITED_REQUEST_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);

/// Applies [`LIMITED_REQUEST_TIMEOUT`] to a request while a speed limit is
/// active (issue #421). Why read the limiter live per call: the cap can be
/// reconfigured mid-download, and the next request build must pick up the
/// current state.
fn with_limited_request_timeout(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if DOWNLOAD_SPEED_LIMITER.limit_bps() > 0 {
        builder.timeout(LIMITED_REQUEST_TIMEOUT)
    } else {
        builder
    }
}

/// Sets the download stage based on filename pattern.
///
/// Files starting with "temp_audio" are marked as "audio" stage,
/// and files starting with "temp_video" are marked as "video" stage.
/// This allows the frontend to display which part of the download process is active.
async fn set_stage_from_filename<R: Runtime>(emits: &Emits<R>, filename: &str) {
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

/// Flushes the segment file before returning a resume-carrying error.
///
/// Why: tokio's `File::write_all` hands the chunk to a blocking-pool write
/// and resolves immediately — the bytes may not have reached the OS yet
/// when `download_segment_stream` returns `Slow(received)` /
/// `Reconnect(received)`. The caller's `verify_resume_tail` re-reads the
/// tail from disk; unflushed bytes read as pre-allocated zeros and force a
/// false rejection (observed as mystery rejections under parallel write
/// load, 2026-08-31). Flushing here also surfaces a swallowed write error
/// on the final chunk (e.g. ENOSPC): without it, `received` counts bytes
/// that never landed and a resume would stitch a gap into the file — so a
/// flush failure is promoted to `DiskError` instead of the resume error.
async fn flush_before_resume(file: &mut tokio::fs::File, resume_err: SegmentError) -> SegmentError {
    match file.flush().await {
        Ok(()) => resume_err,
        Err(e) => to_segment_disk_error(e),
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
    // Why the is_empty guard: the doc contract says None OR empty is a
    // no-op, but the original impl set an empty Cookie header for Some("")
    // — harmless for Bilibili but a needless header; aligned to the doc.
    if let Some(c) = cookie {
        if !c.is_empty() {
            req = req.header(header::COOKIE, c);
        }
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
    match DOWNLOAD_CANCEL_REGISTRY.get_token(id) {
        Some(t) => Ok(Some(t)),
        None => {
            if DOWNLOAD_CANCEL_REGISTRY.is_cancelled(id) {
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
pub async fn download_url<R: Runtime>(
    app: &AppHandle<R>,
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
            // Same-CDN resume attempts on the aggregate-slow path (see
            // MAX_SLOW_RESUMES). Independent from `same_cdn_retries` so a
            // slow link cannot starve stream-error recovery.
            let mut slow_resumes: u8 = 0;
            // Full restarts on the same CDN after a tail-verification
            // rejection (see MAX_TAIL_REJECT_RESTARTS). Shared by the SLOW
            // and Reconnect arms so one flapping host cannot burn more than
            // one no-cost restart before a real rotation.
            let mut tail_reject_restarts: u8 = 0;
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

                // Issue #421: while a limit paces this transfer below the
                // 120s client timeout's assumed throughput, extend this
                // request's budget (see with_limited_request_timeout).
                let req_builder = with_limited_request_timeout(
                    client_c
                        .get(current_url)
                        .header(header::RANGE, format!("bytes={}-{}", seg_start, e))
                        .header(header::REFERER, REFERER),
                );
                let req = apply_cookie(req_builder, &cookie_c);
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
                            &cancel_token_c,
                            &stats_cb,
                            // Why a fresh reference from the static: the
                            // limiter is process-global (one aggregate
                            // budget shared by every running download), so
                            // segments read it live instead of snapshotting
                            // at download start (issue #421).
                            &DOWNLOAD_SPEED_LIMITER,
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
                            // Mirror of DiskError: fail immediately, no retry,
                            // no rotation. emits/monitor shutdown is handled
                            // by the collect loop's ERR::CANCELLED propagation.
                            Err(SegmentError::Cancelled) => {
                                log::info!(
                                    "[BE] download_url: segment {} download cancelled",
                                    idx
                                );
                                return Err(anyhow::anyhow!("ERR::CANCELLED"));
                            }
                            Err(SegmentError::Slow(received)) => {
                                let mut action =
                                    decide_slow_action(received, seg_remaining, slow_resumes);
                                if matches!(action, SlowAction::ResumeSameCdn)
                                    && !verify_resume_tail(
                                        &client_c,
                                        current_url,
                                        &cookie_c,
                                        &path_c,
                                        s,
                                        seg_start + received,
                                    )
                                    .await
                                {
                                    // Tail verification failed: stitching here
                                    // would corrupt the file. Try one free
                                    // full restart on the same host first
                                    // (see MAX_TAIL_REJECT_RESTARTS); only a
                                    // second rejection costs a rotation.
                                    if tail_reject_restarts < MAX_TAIL_REJECT_RESTARTS {
                                        tail_reject_restarts += 1;
                                        log::warn!(
                                            "[BE] download_url: segment {} same-CDN resume rejected by tail verification, fully restarting segment on same CDN #{} (reject restart {}/{})",
                                            idx,
                                            cdn_idx,
                                            tail_reject_restarts,
                                            MAX_TAIL_REJECT_RESTARTS
                                        );
                                        needs_full_restart = true;
                                        backoff_sleep(1).await;
                                        continue;
                                    }
                                    log::warn!(
                                        "[BE] download_url: segment {} same-CDN resume rejected by tail verification, rotating CDN instead",
                                        idx
                                    );
                                    action = SlowAction::RotateCdn;
                                }
                                match action {
                                    SlowAction::Complete => {
                                        // The rotation request is consumed on
                                        // the next chunk arrival, so Slow can
                                        // surface with every expected byte
                                        // already on disk. Finish instead of
                                        // resuming past `e` — a start > end
                                        // Range always 416s and would fail an
                                        // already-complete segment.
                                        stats_c.finished.store(true, Ordering::Relaxed);
                                        return Ok(());
                                    }
                                    SlowAction::ResumeSameCdn => {
                                        // Fresh connection, same host, resume
                                        // from the received offset: the bytes
                                        // on disk stay valid and nothing is
                                        // re-fetched, unlike a rotation's
                                        // full restart. No backoff — waiting
                                        // does not raise CDN throughput.
                                        log::info!(
                                            "[BE] download_url: segment {} slow speed, resuming same CDN #{} at +{} bytes (slow resume {}/{})",
                                            idx,
                                            cdn_idx,
                                            received,
                                            slow_resumes + 1,
                                            MAX_SLOW_RESUMES
                                        );
                                        slow_resumes += 1;
                                        seg_start += received;
                                        seg_remaining = seg_remaining.saturating_sub(received);
                                        continue;
                                    }
                                    SlowAction::RotateCdn => {
                                        // Slow-speed rotations draw from their
                                        // own budget: the monitor only selects
                                        // segments that still have budget
                                        // (slow_budget_exhausted), so a
                                        // request arriving here is always
                                        // within budget. When the budget is
                                        // spent, the flag makes the monitor
                                        // stop selecting this segment — it
                                        // keeps streaming slowly, the same
                                        // safety valve the old per-segment
                                        // check_download_speed had, so
                                        // sub-threshold links still converge
                                        // instead of rotating forever.
                                        // No backoff: waiting does not raise
                                        // CDN throughput.
                                        // Full restart, not resume: the next
                                        // CDN may serve a different byte
                                        // stream for the same path (see
                                        // SegmentError::Slow).
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
                                }
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
                                    // Same edge-version proof as the slow-resume
                                    // path: without it, a simultaneous reconnect
                                    // burst (network drop) can land on a different
                                    // edge and stitch corrupting bytes
                                    // (2026-08-31 19:48 download, 7 segments).
                                    if verify_resume_tail(
                                        &client_c,
                                        current_url,
                                        &cookie_c,
                                        &path_c,
                                        s,
                                        seg_start + received,
                                    )
                                    .await
                                    {
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
                                        seg_remaining =
                                            seg_remaining.saturating_sub(received);
                                        backoff_sleep(same_cdn_retries).await;
                                        continue;
                                    }
                                    // Rejected: one free same-host full
                                    // restart before paying the rotation
                                    // cost (same policy as the slow-resume
                                    // arm).
                                    if tail_reject_restarts < MAX_TAIL_REJECT_RESTARTS {
                                        tail_reject_restarts += 1;
                                        log::warn!(
                                            "[BE] download_url: segment {} same-CDN retry rejected by tail verification, fully restarting segment on same CDN #{} (reject restart {}/{})",
                                            idx,
                                            cdn_idx,
                                            tail_reject_restarts,
                                            MAX_TAIL_REJECT_RESTARTS
                                        );
                                        needs_full_restart = true;
                                        backoff_sleep(1).await;
                                        continue;
                                    }
                                    log::warn!(
                                        "[BE] download_url: segment {} same-CDN retry rejected by tail verification, rotating CDN",
                                        idx
                                    );
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
            // Read per sample (not captured at spawn) so a mid-download
            // limit change applies to the verdict immediately (issue #421).
            let limit_bps = DOWNLOAD_SPEED_LIMITER.limit_bps();
            log::info!(
                "[BE] download_url: aggregate speed {} KiB/s over {}s{}",
                bps / 1024,
                elapsed,
                if limit_bps > 0 {
                    format!(" (speed limit {} KiB/s active)", limit_bps / 1024)
                } else {
                    String::new()
                }
            );

            if limit_bps > 0 {
                // Issue #421: a user-set limit intentionally holds total
                // throughput below MIN_SPEED_THRESHOLD — throttled slowness
                // is policy, not a bad CDN edge, so rotating the slowest
                // segment would churn connections forever. RESET (not just
                // skip) consecutive_slow so a pre-limit slow sample cannot
                // fire a rotation on the first post-limit tick.
                consecutive_slow = 0;
                continue;
            }

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
                // Cancelled propagates the same way (issue #562): otherwise
                // the seg_errors counter below rewrites it into
                // "N segment(s) failed" (no ERR:: prefix), which
                // retry_download treats as a transient network failure and
                // retries — restarting a download the user just cancelled.
                let msg = e.to_string();
                if msg.contains("ERR::INVALID_MEDIA_RESPONSE") || msg.contains("ERR::CANCELLED") {
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
/// * `cancel_token` - Cancellation token checked on every received chunk
///   (issue #562): a flag read, so the per-chunk cost is negligible
/// * `stats` - This segment's shared stats: receives byte counts, rotation
///   requests
/// * `limiter` - Aggregate speed limiter consulted per chunk (issue #421);
///   one shared per-process budget across all segments and downloads
/// * `on_chunk_received` - Callback invoked when each chunk is received
///
/// # Returns
///
/// - `Ok(received)`: Download complete; bytes streamed to `path` at `pos`,
///   `received` is the total bytes written.
/// - `Err(SegmentError::Slow(received))`: The aggregate-speed monitor
///   flagged TOTAL throughput below [`MIN_SPEED_THRESHOLD`] and selected
///   this segment; the caller first resumes the SAME CDN from the received
///   offset (fresh connection), then falls back to a CDN rotation with a
///   full segment restart once that budget is spent.
/// - `Err(SegmentError::Reconnect(received))`: The body stream broke
///   mid-transfer (connection reset, decoding error) or stalled for
///   [`SEGMENT_STALL_TIMEOUT_SECS`]. The caller first retries the SAME CDN
///   resuming at `pos + received`; after that budget runs out it rotates CDN
///   and fully restarts the segment.
/// - `Err(SegmentError::DiskError(e))`: Unrecoverable disk write failure
///   (e.g. ENOSPC → ERR::DISK_FULL); the caller fails the download.
/// - `Err(SegmentError::Cancelled)`: Download cancellation observed on a
///   received chunk; the caller fails the download with `ERR::CANCELLED`.
#[allow(clippy::too_many_arguments)]
async fn download_segment_stream(
    resp: &mut reqwest::Response,
    idx: usize,
    cdn_idx: usize,
    pos: u64,
    path: &Path,
    cancel_token: &Option<CancellationToken>,
    stats: &SegmentStats,
    limiter: &SpeedLimiter,
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
                return Err(
                    flush_before_resume(&mut file, SegmentError::Reconnect(received)).await,
                );
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

                // Honor a cancellation request before anything else (issue
                // #562): a flag read like rotate_requested below, checked on
                // every chunk so a healthy-but-slow CDN cannot run a whole
                // segment to completion after the user cancelled. No flush
                // needed — nothing resumes after a cancel, the caller fails
                // with ERR::CANCELLED and cleanup deletes the partial file.
                if cancel_token.as_ref().is_some_and(|t| t.is_cancelled()) {
                    log::info!(
                        "[BE] download_segment: segment {} CDN #{} cancelled after {} bytes",
                        idx,
                        cdn_idx,
                        received
                    );
                    return Err(SegmentError::Cancelled);
                }

                // Honor a monitor rotation request: consume the flag and
                // surface as Slow so the caller first resumes the SAME CDN
                // with a fresh connection (see SegmentError::Slow).
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
                    return Err(flush_before_resume(&mut file, SegmentError::Slow(received)).await);
                }

                // Issue #421: pace aggregate consumption AFTER the
                // cancel/rotate checks so control flags are never delayed
                // by the sleep, and OUTSIDE the stall-timeout wrapper
                // above (it only guards resp.chunk()). Unlimited is a
                // flag-read fast path; a sleep is bounded by the current
                // aggregate slot debt (concurrent consumers × chunk send
                // time — see SpeedLimiter::acquire).
                limiter.acquire(chunk_len).await;
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
                return Err(
                    flush_before_resume(&mut file, SegmentError::Reconnect(received)).await,
                );
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
/// - `ERR::INVALID_MEDIA_RESPONSE` - Non-success HTTP status or non-media
///   content type (so playurl-refetch retry can engage)
/// - Disk I/O failure (mapped to `ERR::DISK_FULL` for ENOSPC)
/// - HTTP/streaming failure from the underlying reqwest response
#[allow(clippy::too_many_arguments)]
async fn single_stream_fallback<R: Runtime>(
    app: &AppHandle<R>,
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

    // Build and send request using the shared client. Issue #421: extend
    // this request's budget while a limit paces the transfer below the 120s
    // client timeout's assumed throughput (see
    // with_limited_request_timeout); liveness stays with the stall wrapper
    // in the chunk loop below.
    let req_builder =
        with_limited_request_timeout(client.get(&url).header(header::REFERER, REFERER));
    let req = apply_cookie(req_builder, &cookie);
    let mut resp = req.send().await?;
    // Reject non-success statuses before streaming to disk. CAUTION: the
    // media guard below cannot catch bare 4xx/5xx — is_media_content_type
    // treats a MISSING Content-Type header as media, so a 404 with no
    // content-type was persisted as a 0-byte "download".
    if !resp.status().is_success() {
        log::error!(
            "[BE] download_url: single-stream invalid status {}, not streaming to disk",
            resp.status()
        );
        return Err(anyhow::anyhow!("ERR::INVALID_MEDIA_RESPONSE"));
    }
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

    let mut downloaded: u64 = 0;
    // Stream to disk; on ANY failure (open, stream error, cancel, disk
    // error) stop the emitter first — its ticker task only exits once
    // is_complete is set, so returning without stop()/complete() leaks a
    // 500ms progress loop.
    let result: Result<()> = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&output_path)
            .await
            .map_err(map_io_error)?;

        loop {
            // Issue #421: give the fallback the same per-chunk stall
            // liveness the segment path has — it is unconditional (a
            // strict improvement over waiting out the 120s whole-request
            // timeout on a dead connection) and REQUIRED once a speed
            // limit extends that whole-request budget to 24h.
            let chunk = match tokio::time::timeout(
                Duration::from_secs(SEGMENT_STALL_TIMEOUT_SECS),
                resp.chunk(),
            )
            .await
            {
                Ok(c) => c?,
                Err(_) => {
                    log::warn!(
                        "[BE] download_url: single-stream stalled: no chunk for {}s after {} bytes",
                        SEGMENT_STALL_TIMEOUT_SECS,
                        downloaded
                    );
                    // No ERR:: prefix — the caller treats it as a
                    // transient failure and retries, like any mid-stream
                    // chunk error today.
                    return Err(anyhow::anyhow!(
                        "single-stream stalled: no chunk for {}s after {} bytes",
                        SEGMENT_STALL_TIMEOUT_SECS,
                        downloaded
                    ));
                }
            };
            let Some(chunk) = chunk else { break };
            check_cancelled(&cancel_token)?;
            file.write_all(&chunk).await.map_err(map_io_error)?;
            downloaded += chunk.len() as u64;
            // Emit progress update via watch channel (non-blocking)
            emits.update_progress(downloaded);
            // Issue #421: pace aggregate consumption from the shared
            // per-process budget; unlimited is a flag-read fast path.
            DOWNLOAD_SPEED_LIMITER.acquire(chunk.len() as u64).await;
        }
        file.flush().await.map_err(map_io_error)?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            if emit_complete {
                emits.complete().await;
            } else {
                // Stop background task without emitting complete event
                emits.stop().await;
            }
            Ok(())
        }
        Err(e) => {
            emits.stop().await;
            Err(e)
        }
    }
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

    #[test]
    fn calculate_segments_splits_total_into_ranges() {
        // 10 bytes / size 4 -> [0-3],[4-7],[8-9]
        assert_eq!(calculate_segments(10, 4), vec![(0, 3), (4, 7), (8, 9)]);
        // Exact multiples leave no tail segment
        assert_eq!(calculate_segments(8, 4), vec![(0, 3), (4, 7)]);
        // Single segment when total < size
        assert_eq!(calculate_segments(3, 4), vec![(0, 2)]);
        // Zero total -> no segments (no infinite loop)
        assert!(calculate_segments(0, 4).is_empty());
    }

    #[test]
    fn cdn_rotation_limit_caps_url_count_and_multiplies_loops() {
        use crate::constants::MAX_CDN_LOOPS;
        assert_eq!(cdn_rotation_limit(0), 0);
        assert_eq!(cdn_rotation_limit(1), MAX_CDN_LOOPS);
        assert_eq!(cdn_rotation_limit(5), 5 * MAX_CDN_LOOPS);
        // Saturating u8 arithmetic: 300 urls -> 255 cap -> 255*3 saturates at u8::MAX
        assert_eq!(cdn_rotation_limit(300), u8::MAX);
    }

    #[test]
    fn slow_action_fully_received_segment_completes() {
        // Rotation request is consumed on a chunk arrival, so Slow can
        // surface with every expected byte already on disk.
        assert_eq!(decide_slow_action(1000, 1000, 0), SlowAction::Complete);
        assert_eq!(
            decide_slow_action(1000, 1000, MAX_SLOW_RESUMES),
            SlowAction::Complete
        );
    }

    #[test]
    fn slow_action_resumes_same_cdn_within_budget() {
        let delivered = SLOW_RESUME_MIN_BYTES + 1;
        let remaining = delivered + 1000; // normal case: received < remaining
        assert_eq!(
            decide_slow_action(delivered, remaining, 0),
            SlowAction::ResumeSameCdn
        );
        let last = MAX_SLOW_RESUMES.saturating_sub(1);
        assert_eq!(
            decide_slow_action(delivered, remaining, last),
            SlowAction::ResumeSameCdn
        );
    }

    #[test]
    fn slow_action_rotates_after_resume_budget_spent() {
        let delivered = SLOW_RESUME_MIN_BYTES + 1;
        let remaining = delivered + 1000;
        assert_eq!(
            decide_slow_action(delivered, remaining, MAX_SLOW_RESUMES),
            SlowAction::RotateCdn
        );
        assert_eq!(
            decide_slow_action(delivered, remaining, MAX_SLOW_RESUMES + 5),
            SlowAction::RotateCdn
        );
    }

    #[test]
    fn slow_action_min_bytes_boundary() {
        // Exactly the minimum still resumes...
        assert_eq!(
            decide_slow_action(SLOW_RESUME_MIN_BYTES, SLOW_RESUME_MIN_BYTES + 1000, 0),
            SlowAction::ResumeSameCdn
        );
        // ...one byte less rotates: a near-empty attempt means the
        // connection is already fresh and still dead — the node is the
        // bottleneck, not the connection.
        assert_eq!(
            decide_slow_action(SLOW_RESUME_MIN_BYTES - 1, SLOW_RESUME_MIN_BYTES + 999, 0),
            SlowAction::RotateCdn
        );
    }

    #[test]
    fn slow_action_near_zero_received_rotates_without_burning_budget() {
        // Observed in the 2026-08-31 19:22 log: Slow surfaced at +15 KiB
        // and +7 KiB right after stream-error reconnects. Those resumes
        // wasted the budget on connections that were already fresh.
        let remaining = 10 * SLOW_RESUME_MIN_BYTES;
        assert_eq!(decide_slow_action(0, remaining, 0), SlowAction::RotateCdn);
        assert_eq!(
            decide_slow_action(15_141, remaining, 0),
            SlowAction::RotateCdn
        );
        assert_eq!(
            decide_slow_action(6_951, remaining, 0),
            SlowAction::RotateCdn
        );
    }

    #[test]
    fn resume_verify_range_window_ends_at_stitch_point() {
        // Segment starting at s = 32 MiB, 5 MiB received: the verify window
        // must END at the stitch point (s + received) and stay inside this
        // segment — the bytes the next attempt appends to.
        let s = 32 * 1024 * 1024;
        let end = s + 5_000_000;
        assert_eq!(
            resume_verify_range(s, end),
            Some((end - SAME_STREAM_VERIFY_BYTES, SAME_STREAM_VERIFY_BYTES))
        );
        // Short on-disk progress (under the cap): verify all of it.
        assert_eq!(resume_verify_range(s, s + 500), Some((s, 500)));
    }

    #[test]
    fn resume_verify_range_segment_zero_first_resume_is_verified() {
        // Regression (review 2026-08-31): segment 0's FIRST resume was
        // skipped entirely (len clamped to 0 via the old seg_start cap),
        // leaving the goi3-style corruption case unguarded. The window must
        // cover the tail of the received bytes, not return None.
        assert_eq!(
            resume_verify_range(0, 5_000_000),
            Some((
                5_000_000 - SAME_STREAM_VERIFY_BYTES,
                SAME_STREAM_VERIFY_BYTES
            ))
        );
        // Even a sub-cap first stitch of segment 0 verifies fully.
        assert_eq!(resume_verify_range(0, 500), Some((0, 500)));
    }

    #[test]
    fn resume_verify_range_none_when_nothing_on_disk() {
        // No on-disk progress in this segment: no stitch point, resume
        // trivially safe.
        assert_eq!(resume_verify_range(0, 0), None);
        assert_eq!(resume_verify_range(123, 123), None);
    }

    #[test]
    fn slow_action_over_delivery_completes_instead_of_underflowing() {
        // An over-delivering edge (received > remaining) must complete, not
        // fall through to a subtraction that underflows (review 2026-08-31).
        assert_eq!(decide_slow_action(2_000, 1_000, 0), SlowAction::Complete);
    }

    // ---- download_segment_stream cancellation (issue #562) ----

    /// Drives download_segment_stream against a wiremock server streaming
    /// `body`, writing into a pre-created file at `path`. The limiter is
    /// injected so pacing tests run on a FRESH SpeedLimiter instead of the
    /// process-global DOWNLOAD_SPEED_LIMITER (parallel tests share that
    /// static and would race on set_bps).
    async fn segment_stream_against_mock(
        body: Vec<u8>,
        cancel_token: Option<CancellationToken>,
        path: &std::path::Path,
        limiter: &crate::handlers::concurrency::SpeedLimiter,
    ) -> Result<u64, SegmentError> {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_bytes(body))
            .mount(&server)
            .await;
        let mut resp = reqwest::Client::new()
            .get(server.uri())
            .send()
            .await
            .unwrap();
        let stats = SegmentStats::new();
        download_segment_stream(
            &mut resp,
            0,
            0,
            0,
            path,
            &cancel_token,
            &stats,
            limiter,
            |_| {},
        )
        .await
    }

    #[tokio::test]
    async fn segment_stream_returns_cancelled_when_token_cancelled() {
        // Regression (issue #562): with cancel only checked at segment
        // start/retry, a healthy-but-slow CDN streamed a whole segment to
        // completion after cancel (observed 47s lag). The per-chunk check
        // must surface Cancelled on the first received chunk instead.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, []).unwrap();

        let token = CancellationToken::new();
        token.cancel();

        let result = segment_stream_against_mock(
            vec![0xAB; 64 * 1024],
            Some(token),
            &path,
            &SpeedLimiter::unlimited(),
        )
        .await;
        assert!(matches!(result, Err(SegmentError::Cancelled)));
    }

    #[tokio::test]
    async fn segment_stream_completes_without_cancel_token() {
        // Happy path guard: no token registered — the per-chunk check must
        // not disturb a normal stream.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, []).unwrap();

        let body = vec![0xCD; 64 * 1024];
        let result =
            segment_stream_against_mock(body.clone(), None, &path, &SpeedLimiter::unlimited())
                .await;
        assert_eq!(result.unwrap(), body.len() as u64);
        assert_eq!(std::fs::read(&path).unwrap(), body);
    }

    // ---- download_segment_stream speed limiting (issue #421) ----

    #[tokio::test]
    async fn segment_stream_paces_under_speed_limit() {
        // 64 KiB at 256 KiB/s: the slot schedule must space consumption so
        // the whole body spans ≈ 250 ms of pacing (the first chunk's slot
        // starts at `now`, every later chunk waits). Loose lower bound to
        // stay CI-stable; the unlimited sibling test below guards the
        // upper direction by byte correctness.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, []).unwrap();

        let limiter = SpeedLimiter::unlimited();
        limiter.set_bps(256 * 1024);

        let body = vec![0xEF; 64 * 1024];
        let started = std::time::Instant::now();
        let result = segment_stream_against_mock(body.clone(), None, &path, &limiter).await;
        let elapsed = started.elapsed();

        assert_eq!(result.unwrap(), body.len() as u64);
        assert_eq!(std::fs::read(&path).unwrap(), body);
        assert!(
            elapsed >= std::time::Duration::from_millis(150),
            "limited stream must be paced: elapsed {:?} for 64KiB at 256KiB/s",
            elapsed
        );
    }
    // ---- verify_resume_tail (same-CDN resume guard, PR #558) ----

    /// Mounts a 206 response serving `body` with a Content-Range starting at
    /// `start`, mirroring a same-stream CDN edge.
    async fn resume_mock(content_range_start: Option<u64>, body: Vec<u8>) -> wiremock::MockServer {
        let server = wiremock::MockServer::start().await;
        let mut resp = wiremock::ResponseTemplate::new(206).set_body_bytes(body);
        if let Some(start) = content_range_start {
            resp = resp.insert_header(
                "Content-Range",
                format!("bytes {}-{}/{}", start, start + 1023, 4096),
            );
        }
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(resp)
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn resume_tail_matching_bytes_allows_resume() {
        // 64 KiB on disk; the edge re-serves the identical tail bytes.
        let on_disk: Vec<u8> = (0..64 * 1024u32).map(|i| (i % 251) as u8).collect();
        let start = on_disk.len() as u64 - SAME_STREAM_VERIFY_BYTES;
        let tail = on_disk[(on_disk.len() - SAME_STREAM_VERIFY_BYTES as usize)..].to_vec();
        let server = resume_mock(Some(start), tail).await;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, &on_disk).unwrap();

        assert!(
            verify_resume_tail(
                &reqwest::Client::new(),
                &server.uri(),
                &None,
                &path,
                0,
                on_disk.len() as u64,
            )
            .await
        );
    }

    #[tokio::test]
    async fn resume_tail_rejects_when_edge_serves_different_bytes() {
        let on_disk = vec![0x11u8; 64 * 1024];
        // Same length, different content: the edge switched byte streams.
        let different = vec![0x22u8; 64 * 1024];
        let server = resume_mock(Some(0), different).await;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, &on_disk).unwrap();

        assert!(
            !verify_resume_tail(
                &reqwest::Client::new(),
                &server.uri(),
                &None,
                &path,
                0,
                on_disk.len() as u64,
            )
            .await
        );
    }

    #[tokio::test]
    async fn resume_tail_rejects_non_206_or_wrong_range_start() {
        let body = vec![0u8; 1024];
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, &body).unwrap();
        let client = reqwest::Client::new();

        // 200 instead of 206: a Range-ignoring edge is not a resume-safe 206.
        let plain = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_bytes(body.clone()))
            .mount(&plain)
            .await;
        assert!(!verify_resume_tail(&client, &plain.uri(), &None, &path, 0, 1024).await);

        // 206 but Content-Range start disagrees with the verify window.
        let wrong = resume_mock(Some(999), body.clone()).await;
        assert!(!verify_resume_tail(&client, &wrong.uri(), &None, &path, 0, 1024).await);
    }

    #[tokio::test]
    async fn resume_tail_no_progress_is_trivially_safe() {
        // on_disk_end == seg_base: no stitch point, must return true without
        // requiring any HTTP interaction.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seg.bin");
        std::fs::write(&path, [0u8; 0]).unwrap();
        assert!(
            verify_resume_tail(
                &reqwest::Client::new(),
                "http://127.0.0.1:1/never-hit",
                &None,
                &path,
                4096,
                4096
            )
            .await
        );
    }

    // ---- error mapping / cookie / cancel helpers ----

    #[test]
    fn map_io_error_translates_enospc_to_disk_full() {
        let err = map_io_error(std::io::Error::from_raw_os_error(28));
        assert_eq!(err.to_string(), "ERR::DISK_FULL");

        let other = map_io_error(std::io::Error::from_raw_os_error(13));
        assert_eq!(other.to_string(), "Permission denied (os error 13)");
    }

    #[test]
    fn to_segment_disk_error_wraps_as_disk_error() {
        let SegmentError::DiskError(inner) =
            to_segment_disk_error(std::io::Error::from_raw_os_error(28))
        else {
            panic!("ENOSPC must map to SegmentError::DiskError");
        };
        assert_eq!(inner.to_string(), "ERR::DISK_FULL");
    }

    #[test]
    fn apply_cookie_sets_header_only_when_present() {
        let client = reqwest::Client::new();
        let with = apply_cookie(client.get("http://x/"), &Some("SESSDATA=y".into()))
            .build()
            .unwrap();
        assert_eq!(with.headers().get(header::COOKIE).unwrap(), "SESSDATA=y");

        let without = apply_cookie(client.get("http://x/"), &None)
            .build()
            .unwrap();
        assert!(without.headers().get(header::COOKIE).is_none());

        let empty = apply_cookie(client.get("http://x/"), &Some(String::new()))
            .build()
            .unwrap();
        assert!(empty.headers().get(header::COOKIE).is_none());
    }

    #[test]
    fn check_cancelled_flags_only_triggered_tokens() {
        assert!(check_cancelled(&None).is_ok());

        let live = CancellationToken::new();
        assert!(check_cancelled(&Some(live)).is_ok());

        let dead = CancellationToken::new();
        dead.cancel();
        let err = check_cancelled(&Some(dead)).unwrap_err();
        assert_eq!(err.to_string(), "ERR::CANCELLED");
    }

    #[tokio::test]
    async fn resolve_cancel_token_covers_registry_states() {
        let none = resolve_cancel_token("t", &None).await.unwrap();
        assert!(none.is_none());

        let unknown = resolve_cancel_token("t", &Some("r4-never-registered".into()))
            .await
            .unwrap();
        assert!(
            unknown.is_none(),
            "unregistered id without pre-cancel -> Ok(None)"
        );

        let (token, _guard) = DOWNLOAD_CANCEL_REGISTRY.register("r4-live");
        let resolved = resolve_cancel_token("t", &Some("r4-live".into()))
            .await
            .unwrap();
        assert!(resolved.is_some());
        assert!(!token.is_cancelled());
        drop(_guard);

        // Cancel drops the registry's token but records the id: resolve must
        // surface ERR::CANCELLED instead of returning Ok(None) and
        // re-downloading a user-cancelled file.
        let (_tok, _guard2) = DOWNLOAD_CANCEL_REGISTRY.register("r4-cancelled");
        DOWNLOAD_CANCEL_REGISTRY.cancel("r4-cancelled");
        let err = resolve_cancel_token("t", &Some("r4-cancelled".into()))
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "ERR::CANCELLED");
    }

    #[tokio::test]
    async fn flush_before_resume_passes_error_through_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let mut file = tokio::fs::File::create(dir.path().join("f")).await.unwrap();
        let out = flush_before_resume(&mut file, SegmentError::Reconnect(42)).await;
        assert!(matches!(out, SegmentError::Reconnect(42)));
    }

    #[tokio::test]
    async fn preallocate_file_creates_exact_size_and_truncates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        preallocate_file(&path, 4096).await.unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 4096);

        std::fs::write(&path, [0u8; 8192]).unwrap();
        preallocate_file(&path, 4096).await.unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            4096,
            "second preallocation truncates"
        );
    }

    #[test]
    fn is_media_content_type_filters_error_bodies() {
        let h = |s: &str| Some(header::HeaderValue::from_str(s).unwrap());
        assert!(is_media_content_type(None), "missing header stays valid");
        assert!(is_media_content_type(
            h("application/octet-stream").as_ref()
        ));
        assert!(is_media_content_type(h("video/mp4").as_ref()));
        assert!(!is_media_content_type(h("application/json").as_ref()));
        assert!(!is_media_content_type(
            h("application/json; charset=utf-8").as_ref()
        ));
        assert!(!is_media_content_type(h("text/html").as_ref()));
        assert!(!is_media_content_type(h("TEXT/plain").as_ref()));
    }

    #[tokio::test(start_paused = true)]
    async fn backoff_sleep_doubles_then_caps_at_1500ms() {
        for (attempt, expected_ms) in [(1u8, 200u64), (2, 400), (3, 800), (4, 1500), (9, 1500)] {
            let before = tokio::time::Instant::now();
            backoff_sleep(attempt).await;
            assert_eq!(
                before.elapsed().as_millis() as u64,
                expected_ms,
                "attempt {attempt}"
            );
        }
    }

    #[test]
    fn segment_stats_starts_clean_and_flips_flags() {
        let stats = SegmentStats::new();
        assert_eq!(stats.bytes.load(Ordering::Relaxed), 0);
        assert!(!stats.started.load(Ordering::Relaxed));
        assert!(!stats.finished.load(Ordering::Relaxed));
        assert!(!stats.slow_budget_exhausted.load(Ordering::Relaxed));
        assert!(!stats.rotate_requested.load(Ordering::Relaxed));

        stats.bytes.store(123, Ordering::Relaxed);
        stats.started.store(true, Ordering::Relaxed);
        stats.finished.store(true, Ordering::Relaxed);
        stats.rotate_requested.store(true, Ordering::Relaxed);
        assert_eq!(stats.bytes.load(Ordering::Relaxed), 123);
        assert!(stats.started.load(Ordering::Relaxed));
        assert!(stats.finished.load(Ordering::Relaxed));
        assert!(stats.rotate_requested.load(Ordering::Relaxed));
    }

    #[test]
    fn build_download_client_constructs() {
        // Smoke: the shared client must build with the tuned pool options.
        let _client = build_download_client();
    }
    // ---- PR① e2e: download_url / single_stream_fallback via mock_app ----

    /// 4096 bytes (251-value cycle): > MIN_MEDIA_BYTES (1 KiB) so the final
    /// size floor passes, < 32 MiB segment size so one segment covers it.
    fn e2e_body() -> Vec<u8> {
        (0..4096u32).map(|i| (i % 251) as u8).collect()
    }

    /// Mounts the 206 mock that satisfies BOTH the CDN probe and the segment
    /// GET (both carry a Range header).
    async fn segmented_206_mock(server: &wiremock::MockServer, body: &[u8]) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header(
                        "Content-Range",
                        format!("bytes 0-{}/{}", body.len() - 1, body.len()),
                    )
                    .insert_header("Content-Type", "application/octet-stream")
                    .set_body_bytes(body.to_vec()),
            )
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn download_url_segmented_path_writes_exact_bytes() {
        // Proves the Emits<R> generic refactor end-to-end: the whole
        // download pipeline runs against AppHandle<MockRuntime>.
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        let body = e2e_body();
        segmented_206_mock(&server, &body).await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");

        download_url(
            app.handle(),
            server.uri(),
            None,
            path.clone(),
            None,
            false,
            None,
            None,
            false,
            2,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), body, "byte-exact output");
    }

    #[tokio::test]
    async fn download_url_falls_back_when_probe_serves_html() {
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        // Mount order is load-bearing: equal-priority mocks match in
        // registration order, so the Range-header mock must come first to
        // answer the probe; the Range-less mock answers the fallback GET.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::header_exists("range"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "text/html")
                    .set_body_string("<html>error</html>"),
            )
            .mount(&server)
            .await;
        let body = e2e_body();
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/octet-stream")
                    .set_body_bytes(body.clone()),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        download_url(
            app.handle(),
            server.uri(),
            None,
            path.clone(),
            None,
            false,
            None,
            None,
            false,
            2,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), body);
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(
            requests[0].headers.contains_key("range"),
            "probe request carries Range"
        );
        assert!(
            !requests[1].headers.contains_key("range"),
            "fallback GET has no Range"
        );
    }

    #[tokio::test]
    async fn download_url_fallback_rejects_404_with_media_content_type() {
        // Regression for the status guard: a 404 with a media-looking (or
        // absent) Content-Type used to be streamed to disk as a 0-byte
        // "successful" download.
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        // Probe mock: Range-bearing GET gets a media-typed 404, so the probe
        // fails the size lookup and download_url routes to the fallback.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::header_exists("range"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&server)
            .await;
        // Fallback mock: Range-less GET gets the same 404 (with a media
        // content-type so only the status guard can reject it).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(404)
                    .insert_header("Content-Type", "application/octet-stream"),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        let err = download_url(
            app.handle(),
            server.uri(),
            None,
            path.clone(),
            None,
            false,
            None,
            None,
            false,
            2,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap_err();

        assert!(
            err.to_string().contains("ERR::INVALID_MEDIA_RESPONSE"),
            "got: {err}"
        );
        assert!(!path.exists(), "nothing written to disk");
    }

    #[tokio::test]
    async fn download_url_errors_when_file_exists() {
        let app = tauri::test::mock_app();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        std::fs::write(&path, b"existing").unwrap();

        let err = download_url(
            app.handle(),
            // Unroutable: the existence check precedes any HTTP call.
            "http://127.0.0.1:9/x".to_string(),
            None,
            path.clone(),
            None,
            false,
            None,
            None,
            false,
            1,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap_err();

        assert!(err.to_string().contains("ERR::FILE_EXISTS"), "got: {err}");
        assert_eq!(std::fs::read(&path).unwrap(), b"existing");
    }

    #[tokio::test]
    async fn download_url_override_replaces_existing_file() {
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        let body = e2e_body();
        segmented_206_mock(&server, &body).await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        std::fs::write(&path, b"stale junk").unwrap();

        download_url(
            app.handle(),
            server.uri(),
            None,
            path.clone(),
            None,
            true,
            None,
            None,
            false,
            2,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), body);
    }

    #[tokio::test]
    async fn download_url_pre_cancelled_id_errors_immediately() {
        // register -> cancel drops the token but flags the id, so
        // resolve_cancel_token's is_cancelled fallback fires before any HTTP.
        let id = "e2e-precancel";
        let (_token, _guard) = DOWNLOAD_CANCEL_REGISTRY.register(id);
        DOWNLOAD_CANCEL_REGISTRY.cancel(id);

        let app = tauri::test::mock_app();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.bin");
        let err = download_url(
            app.handle(),
            "http://127.0.0.1:9/x".to_string(),
            None,
            path.clone(),
            None,
            false,
            Some(id.to_string()),
            None,
            false,
            1,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await
        .unwrap_err();

        assert!(err.to_string().contains("ERR::CANCELLED"), "got: {err}");
        assert!(!path.exists());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn download_url_fallback_open_failure_stops_emitter() {
        // Drives the error funnel's Err arm (open failure inside the async
        // block): the emitter must be stopped and nothing written.
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::header_exists("range"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "text/html")
                    .set_body_string("x"),
            )
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(
                wiremock::ResponseTemplate::new(200)
                    .insert_header("Content-Type", "application/octet-stream")
                    .set_body_bytes(e2e_body()),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        // Read-only parent: OpenOptions create fails with EACCES
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let path = dir.path().join("out.bin");

        let result = download_url(
            app.handle(),
            server.uri(),
            None,
            path.clone(),
            None,
            false,
            None,
            None,
            false,
            1,
            Arc::new(cdn_selector::HostHealth::new()),
        )
        .await;

        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = result.unwrap_err();
        assert!(!path.exists());
        // The error is the raw io error (EACCES), not a cancel — and the
        // emitter's ticker was stopped by the funnel before returning.
        assert!(!err.to_string().contains("CANCELLED"), "got: {err}");
    }
}
