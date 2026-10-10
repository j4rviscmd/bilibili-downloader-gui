//! Streaming proxy for search-result video previews (`stream://` custom
//! protocol).
//!
//! Why a proxy: three measured (2026-10-09) CDN behaviors make a webview-side
//! `<video src="https://cdn...">` unreliable from overseas networks:
//!
//! 1. Origin groups `og=cos`/`og=hw` reject media-element requests by
//!    `Sec-Fetch-Dest: video` (hotlink heuristic; a forbidden header JS can
//!    never change — same URL succeeds via `fetch()`).
//! 2. Akamai `hdnts` token auth 403s foreign Referers (the app origin) —
//!    mitigated by the `no-referrer` meta, but same class of
//!    request-identity blocking.
//! 3. WKWebView upgrades media fetches to HTTP/3 on Alt-Svc advertisement
//!    and stalls on QUIC (issue #814).
//!
//! Relaying through reqwest sidesteps all three: it sends no `Sec-Fetch-*`
//! headers, no Referer, and speaks HTTP/1.1/2 only. This also lets the
//! playurl reroll prefer the fastest mirror family (akamaized) on every
//! platform instead of avoiding it for WKWebView.
//!
//! Flow: `get_preview_play_url` resolves a CDN URL and stores it under a
//! short-lived opaque token (the raw CDN URL never crosses to the webview).
//! The webview plays `convertFileSrc("preview/{token}", "stream")` and its
//! Range requests are answered here by fetching the same byte window from
//! the CDN and relaying status + bytes.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::constants::USER_AGENT;

/// Upper bound of bytes relayed per protocol request. Media elements issue
/// progressive Range requests, so serving bounded windows streams a
/// multi-hundred-MB MP4 incrementally instead of buffering it whole —
/// responses stay a few MB regardless of video size.
const MAX_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

/// Cumulative served bytes that trigger a BACKGROUND URL rotation. The
/// observed per-URL quota is a few MB (2026-10-10: windows started 403ing
/// after ~6MB served); rotating just below that keeps the media element's
/// next request on a fresh URL instead of paying the mid-request
/// resolve-retry chain that far-seek demuxer timeouts cannot tolerate.
const PRE_WARM_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

/// How long a token's rotation stays suppressed after a failed rotation
/// (resolve loop exhausted / refused). Guards against the throttle
/// amplification loop where every failed window triggers another
/// multi-attempt playurl resolve.
const ROTATION_BACKOFF: Duration = Duration::from_secs(30);

/// Fallback token lifetime when the CDN URL carries no parseable `deadline`
/// query param (every playurl URL observed carries one; this bounds memory
/// if that ever changes).
const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(60 * 60);

/// Probe window (see [`probe_url`]): 256KB — comfortably above the measured
/// ~243KB capped-edge body size, small enough to stay well under the 2s
/// probe budget on slow-but-healthy edges.
const PROBE_WINDOW_BYTES: u64 = 256 * 1024;

/// Token → stored preview. Tokens are opaque 128-bit hex; the store is
/// pruned of expired entries on every insert, so memory is bounded by the
/// previews opened within the TTL window. The `bvid` rides along so the
/// relay can rotate in a FRESH CDN URL when the current one hits Bilibili's
/// per-URL quota (dead/capped/503ing URLs recover only via re-resolve —
/// measured 2026-10-09).
#[derive(Default)]
struct PreviewUrlStore {
    entries: HashMap<String, StoredPreview>,
}

/// One stored preview resolution.
struct StoredPreview {
    bvid: String,
    url: String,
    /// Separate DASH audio m4s (None for durl muxed previews). Rotated
    /// together with `url`.
    audio_url: Option<String>,
    expires_at: Instant,
    /// Cumulative bytes relayed from the current `url`. Bilibili enforces
    /// a per-URL byte quota (a few MB — 2026-10-10 measurements); when
    /// this crosses PRE_WARM_ROTATE_BYTES the handler proactively swaps
    /// in a fresh URL so the media element's NEXT window never meets the
    /// quota wall (a mid-request rotation is too slow for far-seek
    /// demuxer timeouts).
    bytes_served: u64,
    /// True while a background pre-warm rotation is in flight (prevents
    /// stampedes).
    rotating: bool,
    /// When a rotation last failed for this token (rotation backoff —
    /// see `begin_rotation`). None = no active backoff.
    rotation_failed_at: Option<Instant>,
}

impl PreviewUrlStore {
    /// Stores `url` under a fresh token and returns the webview-facing path
    /// (`preview/{token}`) for `convertFileSrc`.
    fn remember(&mut self, bvid: &str, url: &str, audio_url: Option<&str>, now: Instant) -> String {
        self.entries.retain(|_, p| p.expires_at > now);
        let token = format!("{:032x}", rand::random::<u128>());
        let ttl = url_deadline(url)
            .and_then(|deadline_secs| deadline_secs.checked_sub(now_unix()))
            .map_or(DEFAULT_TOKEN_TTL, Duration::from_secs);
        self.entries.insert(
            token.clone(),
            StoredPreview {
                bvid: bvid.to_string(),
                url: url.to_string(),
                audio_url: audio_url.map(str::to_string),
                expires_at: now + ttl,
                bytes_served: 0,
                rotating: false,
                rotation_failed_at: None,
            },
        );
        format!("preview/{token}")
    }

    /// Returns the CDN URL for an unexpired token (lookups repeat — the
    /// media element issues one request per Range window).
    fn lookup(&self, token: &str, now: Instant) -> Option<String> {
        let p = self.entries.get(token)?;
        (p.expires_at > now).then(|| p.url.clone())
    }

    /// Returns the separate DASH audio URL for a token (None for durl
    /// muxed previews — the FE shows a muted badge instead).
    fn lookup_audio(&self, token: &str, now: Instant) -> Option<String> {
        let p = self.entries.get(token)?;
        (p.expires_at > now).then(|| p.audio_url.clone()).flatten()
    }

    /// Swaps in a freshly resolved URL for a token (mid-playback rotation;
    /// keeps the original expiry — the new URL carries its own deadline but
    /// the token lifetime stays anchored to the dialog session).
    fn rotate(&mut self, token: &str, url: &str, audio_url: Option<&str>) {
        if let Some(p) = self.entries.get_mut(token) {
            p.url = url.to_string();
            p.audio_url = audio_url.map(str::to_string);
            p.bytes_served = 0;
            p.rotating = false;
            p.rotation_failed_at = None;
        }
    }

    /// Rotation admission with backoff: true when a rotation may start
    /// now. A recently FAILED rotation suppresses further ones for
    /// ROTATION_BACKOFF — under IP-level throttling every resolve fails,
    /// and letting each failed window trigger another resolve loop
    /// deepens the very risk control causing it (observed 2026-10-10).
    fn begin_rotation(&mut self, token: &str) -> bool {
        let Some(p) = self.entries.get_mut(token) else {
            return false;
        };
        match p.rotation_failed_at {
            Some(at) if at.elapsed() < ROTATION_BACKOFF => false,
            _ => true,
        }
    }

    /// Marks a rotation failure, starting the backoff window.
    fn rotation_failed(&mut self, token: &str) {
        if let Some(p) = self.entries.get_mut(token) {
            p.rotation_failed_at = Some(Instant::now());
        }
    }

    /// bvid for a token (used to re-resolve on rotation).
    fn bvid(&self, token: &str) -> Option<String> {
        self.entries.get(token).map(|p| p.bvid.clone())
    }

    /// Clears the in-flight pre-warm guard (e.g. the background resolve
    /// failed and a later window should be allowed to try again).
    fn clear_rotating(&mut self, token: &str) {
        if let Some(p) = self.entries.get_mut(token) {
            p.rotating = false;
        }
    }

    /// Records bytes served from the current URL and reports whether a
    /// background pre-warm rotation should start (sets `rotating` so only
    /// one runs per crossing).
    fn record_served(&mut self, token: &str, bytes: u64) -> bool {
        let Some(p) = self.entries.get_mut(token) else {
            return false;
        };
        p.bytes_served += bytes;
        !p.rotating && p.bytes_served >= PRE_WARM_ROTATE_BYTES && {
            p.rotating = true;
            true
        }
    }
}

/// `deadline` query param of a playurl URL as unix seconds (the CDN-signed
/// expiry of the URL itself — the natural token lifetime).
fn url_deadline(url: &str) -> Option<u64> {
    url.split_once("deadline=")?
        .1
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

/// Wall-clock unix seconds (separate from `Instant` so expiry math against
/// the CDN deadline stays testable).
fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

/// Clamps an incoming Range header to a bounded `bytes=N-M` upstream request.
///
/// - absent or malformed → first window from byte 0 (media elements always
///   Range-request, but a full 200 of a multi-GB file must never happen)
/// - `bytes=N-` (open-ended) → `bytes=N-{N+MAX_CHUNK_BYTES-1}`
/// - `bytes=N-M` → kept as-is when it fits the chunk cap, else end clamped
///
/// Relaying a capped 206 for an open-ended request is standard partial
/// content: the client simply issues the next window when it needs more.
fn clamped_range(requested: Option<&str>) -> (String, u64) {
    let (start, end) = requested
        .and_then(|h| h.strip_prefix("bytes="))
        .and_then(|spec| {
            let (start, end) = spec.split_once('-')?;
            let start: u64 = start.parse().ok()?;
            let end: Option<u64> = end.parse::<u64>().ok();
            Some((start, end))
        })
        .unwrap_or((0, None));
    // saturating_add: an absurd start (u64 near max) must clamp, not
    // overflow-panic in debug builds.
    let last = end
        .filter(|e| *e < start.saturating_add(MAX_CHUNK_BYTES) && *e >= start)
        .unwrap_or(start.saturating_add(MAX_CHUNK_BYTES - 1));
    (format!("bytes={start}-{last}"), start)
}

/// Shared plain HTTP client for CDN fetches (no cookies — preview URLs are
/// pre-signed; no Referer by design, see the module docs).
fn proxy_client() -> &'static reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        // Why no decompression: the workspace enables reqwest's gzip/brotli
        // features, so a default client silently sends Accept-Encoding and
        // transparently decodes — both fatal for a byte-window relay. A 206
        // body is a raw slice of the MP4 (not a standalone gzip stream, so
        // "error decoding response body" aborts mid-transfer; measured
        // 2026-10-09 app.log on the akamaized edge), and any
        // Content-Length/Content-Range we forward describes the encoded
        // bytes, not the decoded ones. Disabling negotiation makes this a
        // transparent pipe: the CDN never compresses, headers always match
        // the body.
        reqwest::Client::builder()
            // Why HTTP/1.1 only: the akamaized edge serves corrupted /
            // truncated Range bodies over HTTP/2 from some networks
            // (2026-10-09: every proxy "error decoding response body" and
            // the pre-proxy webview stalls were h2; plain h1 curl/python
            // fetch the same windows byte-complete). Same root family as
            // the WKWebView QUIC stalls — this edge's h2/h3 paths degrade
            // overseas.
            .http1_only()
            // Hard per-request cap: capped edges also HANG on some
            // continuation offsets (bytes=249233- never answered,
            // measured 2026-10-09); without this the relay stalls forever
            // and the media element dies on its own internal timeout.
            .timeout(Duration::from_secs(10))
            .no_gzip()
            .no_brotli()
            .build()
            .expect("client without decompression always builds")
    });
    &CLIENT
}

static STORE: LazyLock<Mutex<PreviewUrlStore>> =
    LazyLock::new(|| Mutex::new(PreviewUrlStore::default()));

/// `get_preview_play_url` calls this: stores the resolved URL and returns
/// the webview-facing path.
pub fn remember_preview_url(bvid: &str, url: &str, audio_url: Option<&str>) -> String {
    let mut guard = lock_store();
    guard.remember(bvid, url, audio_url, Instant::now())
}

/// Audio-track proxy path for a remembered video path: same token under
/// the `preview-audio` prefix (`preview/{token}` →
/// `preview-audio/{token}`).
pub fn audio_path_of(video_path: &str) -> String {
    format!(
        "preview-audio/{}",
        video_path.trim_start_matches("preview/")
    )
}

fn lock_store() -> std::sync::MutexGuard<'static, PreviewUrlStore> {
    // Poisoning only happens on a panic mid-lock; recovering the inner
    // store keeps previews alive instead of poisoning the protocol forever.
    STORE.lock().unwrap_or_else(|p| p.into_inner())
}

/// Entry point for the `stream://` protocol handler (lib.rs registration).
pub async fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    respond_inner(request, Some(app)).await
}

/// App-less core of [`respond`] so tests can exercise the decode/relay
/// path without an AppHandle (`None` skips the URL-rotation fallback).
async fn respond_inner(
    request: Request<Vec<u8>>,
    app: Option<&tauri::AppHandle>,
) -> Response<Vec<u8>> {
    // convertFileSrc percent-encodes the whole path (encodeURIComponent),
    // so the webview requests /preview%2F{token} — decode before the
    // prefix strip or the lookup key never matches (same decode tauri's
    // asset protocol performs on its paths). Tokens are plain hex, so no
    // traversal is possible through the decoded value (HashMap lookup).
    let path = percent_decode_str(request.uri().path()).decode_utf8_lossy();
    // One token, two tracks: /preview/{token} serves the video URL,
    // /preview-audio/{token} the separate DASH audio m4s (durl muxed
    // previews have no audio track — that prefix 404s and the FE falls
    // back to a muted badge).
    let (token, want_audio) = if let Some(rest) = path.strip_prefix("/preview-audio/") {
        (rest.to_string(), true)
    } else {
        (path.trim_start_matches("/preview/").to_string(), false)
    };
    let url = if want_audio {
        lock_store().lookup_audio(&token, Instant::now())
    } else {
        lock_store().lookup(&token, Instant::now())
    };
    let Some(url) = url else {
        return simple_response(StatusCode::NOT_FOUND, "preview token not found or expired");
    };
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    let mut relay = relay_range(proxy_client(), &url, range).await;
    // Why rotate: Bilibili's CDN enforces per-URL quotas (a URL that
    // streamed a few MB starts answering 503 / zero-byte 206 / hangs —
    // measured 2026-10-09; fresh resolves recover). A failed window means
    // the stored URL is spent: re-resolve the SAME video and retry the
    // window on the fresh URL so playback continues mid-stream.
    if relay.status() == StatusCode::BAD_GATEWAY {
        let Some(app) = app else {
            return relay;
        };
        // Rotation backoff: when the CDN is throttling this client at the
        // IP/account level (every draw 403s — observed 2026-10-10 after
        // heavy use), each failed window would otherwise trigger a full
        // playurl resolve loop, hammering the very risk control that
        // caused the failure and deepening the throttle. After a failed
        // rotation, further rotations pause for the cooldown window.
        if !lock_store().begin_rotation(&token) {
            return relay;
        }
        let Some(bvid) = lock_store().bvid(&token) else {
            return relay;
        };
        let Some((fresh, fresh_audio)) =
            crate::handlers::bilibili::resolve_preview_cdn_url(app, &bvid).await
        else {
            lock_store().rotation_failed(&token);
            return relay;
        };
        log::info!("[BE] preview_stream: rotating spent CDN URL for bvid={bvid} (window retry)");
        lock_store().rotate(&token, &fresh, fresh_audio.as_deref());
        // Retry the SAME lane that failed: an audio-lane window
        // must never be answered with video bytes. A fresh draw
        // without a separate audio track (durl) 404s the audio
        // lane, matching how a durl preview that never had one
        // behaves.
        match rotation_retry_url(want_audio, &fresh, fresh_audio.as_deref()) {
            Some(retry) => relay = relay_range(proxy_client(), &retry, range).await,
            None => {
                return simple_response(
                    StatusCode::NOT_FOUND,
                    "preview audio track unavailable after rotation",
                )
            }
        }
    }
    // Pre-warm rotation: count what we just served from the current URL
    // and, past the quota-proximity threshold, swap in a fresh URL in the
    // BACKGROUND — before the element's next window can hit the quota
    // wall (see PRE_WARM_ROTATE_BYTES). Video-lane bytes only: the audio
    // track is a few hundred KB and rides the video lane's rotation.
    if relay.status() == StatusCode::PARTIAL_CONTENT && !want_audio {
        let served = relay.body().len() as u64;
        if lock_store().record_served(&token, served) {
            let Some(app) = app.cloned() else {
                return relay;
            };
            let Some(bvid) = lock_store().bvid(&token) else {
                return relay;
            };
            tauri::async_runtime::spawn(async move {
                match crate::handlers::bilibili::resolve_preview_cdn_url(&app, &bvid).await {
                    Some((fresh, fresh_audio)) => {
                        log::info!("[BE] preview_stream: pre-warm rotation for bvid={bvid}");
                        lock_store().rotate(&token, &fresh, fresh_audio.as_deref());
                    }
                    None => {
                        // Resolve failed; clear the guard so a later
                        // window can retry the pre-warm.
                        lock_store().clear_rotating(&token);
                    }
                }
            });
        }
    }
    relay
}

/// Retry URL after a rotation, for the lane that failed: the audio lane
/// retries on the fresh AUDIO URL. `None` when the fresh draw is a durl
/// muxed preview — no separate audio track to serve.
fn rotation_retry_url(want_audio: bool, fresh: &str, fresh_audio: Option<&str>) -> Option<String> {
    match (want_audio, fresh_audio) {
        (true, Some(audio)) => Some(audio.to_string()),
        (true, None) => None,
        (false, _) => Some(fresh.to_string()),
    }
}

/// Verifies a resolved CDN URL actually delivers bytes before the reroll
/// loop hands it to the webview. One window, FULLY delivered:
///
/// - dead edges answer 206 headers and never send a body (2026-10-09)
/// - capped edges deliver only ~243KB regardless of the Range asked and
///   hang on the immediate continuation offset — a window LARGER than the
///   cap detects them (short body) without hardcoding the cap value
/// - hanging edges fail the 2s timeout
///
/// Same client config as the relay (HTTP/1.1, no content-encoding
/// negotiation) so the probe measures the exact transport playback uses.
/// A file legitimately smaller than the window passes by matching its own
/// total size from Content-Range.
pub async fn probe_url(url: &str) -> bool {
    let probe_last = PROBE_WINDOW_BYTES - 1;
    let Ok(response) = proxy_client()
        .get(url)
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::RANGE, format!("bytes=0-{probe_last}"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let total = response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let required = match total {
        // Whole file smaller than the probe window: everything must be
        // there.
        Some(t) if t <= PROBE_WINDOW_BYTES => t,
        _ => PROBE_WINDOW_BYTES,
    };
    // Read at most `required + 1` bytes: the +1 distinguishes a body
    // LARGER than required (Range ignored — a 200 full entity) from an
    // exact match without buffering an unbounded body inside the probe
    // budget.
    let limit = required + 1;
    let mut body: Vec<u8> = Vec::with_capacity(required as usize);
    let mut stream = response.bytes_stream();
    while let Some(item) = futures::StreamExt::next(&mut stream).await {
        match item {
            Ok(chunk) => {
                let remaining = (limit - body.len() as u64) as usize;
                body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if body.len() as u64 >= limit {
                    break;
                }
            }
            Err(_) => return false,
        }
    }
    body.len() as u64 == required && required > 0
}

/// Fetches the clamped Range window from the CDN and relays the response.
///
/// Truncate-tolerant by design: some akamaized edges cap every response
/// body at ~243KB regardless of the Range asked (measured 2026-10-09:
/// `bytes=0-65535` complete, larger windows all cut at byte 249,233, then
/// premature EOF — reqwest surfaces this as "error decoding response
/// body"). Instead of failing, the relay serves the bytes that DID arrive
/// as a valid smaller 206 (Content-Range/Length rewritten to the partial
/// window); the media element simply requests the next window from there.
/// Continuation offsets past the cap are served fine by the same edge.
async fn relay_range(
    client: &reqwest::Client,
    url: &str,
    requested_range: Option<&str>,
) -> Response<Vec<u8>> {
    let (range_header, start) = clamped_range(requested_range);
    log::info!(
        "[BE] preview_stream: relay request range={requested_range:?} -> upstream {range_header}"
    );
    let mut window = match fetch_window(client, url, &range_header, false).await {
        Some(w) => w,
        None => {
            // Transport-level send errors (connection reset mid-use —
            // measured 2026-10-10 on rapid seek fetches) get one
            // fresh-connection retry before failing the window.
            log::info!(
                "[BE] preview_stream: send error, retrying on a fresh connection (start={start})"
            );
            match fetch_window(client, url, &range_header, true).await {
                Some(w) => w,
                None => {
                    return simple_response(StatusCode::BAD_GATEWAY, "preview CDN request failed")
                }
            }
        }
    };
    if window.body.is_empty() {
        // Zero-byte 206s were observed as a POOLED-CONNECTION artifact:
        // the same offset answered 206 with no body on the reused
        // keep-alive connection (twice, 2026-10-09 bytes=7032188-) —
        // retry the identical window once on a fresh connection before
        // giving up.
        log::info!(
            "[BE] preview_stream: zero-byte window, retrying on a fresh connection (start={start})"
        );
        if let Some(retry) = fetch_window(client, url, &range_header, true).await {
            window = retry;
        }
    }
    if window.body.is_empty() {
        log::warn!(
            "[BE] preview_stream: CDN delivered zero bytes (status={})",
            window.status
        );
        return simple_response(StatusCode::BAD_GATEWAY, "preview CDN delivered no bytes");
    }
    if window.truncated {
        log::info!(
            "[BE] preview_stream: truncated window served partially ({}B at start={start})",
            window.body.len()
        );
    }
    let Window {
        total,
        content_type,
        body,
        ..
    } = window;
    let last = start + body.len() as u64 - 1;
    let mut builder = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCEPT_RANGES, "bytes");
    if let Some(total) = total {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{last}/{total}"),
        );
    }
    builder
        .body(body)
        .unwrap_or_else(|_| simple_response(StatusCode::BAD_GATEWAY, "invalid relay headers"))
}

/// One upstream window fetch: response metadata plus the collected body
/// (capped at [`MAX_CHUNK_BYTES`], tolerant of mid-body truncation).
/// `None` means the request itself failed — nothing to relay.
async fn fetch_window(
    client: &reqwest::Client,
    url: &str,
    range_header: &str,
    fresh_connection: bool,
) -> Option<Window> {
    let mut request = client
        .get(url)
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::RANGE, range_header);
    if fresh_connection {
        request = request.header(header::CONNECTION, "close");
    }
    let upstream = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[BE] preview_stream: CDN request failed: {e:#}");
            return None;
        }
    };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if !status.is_success() {
        log::warn!("[BE] preview_stream: CDN refused window (status={status})");
        return Some(Window {
            status,
            total: None,
            content_type: header::HeaderValue::from_static("video/mp4"),
            body: Vec::new(),
            truncated: false,
        });
    }
    // Total file size from the upstream Content-Range ("bytes s-e/total") —
    // needed to rewrite a truthful Content-Range for truncated windows.
    let total = upstream
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("video/mp4"));

    // Read the stream chunk-wise; an Err mid-body means the edge cut the
    // transfer — keep what arrived.
    let mut body: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut stream = upstream.bytes_stream();
    while let Some(item) = futures::StreamExt::next(&mut stream).await {
        match item {
            Ok(chunk) => {
                // Trim to the cap so a large final chunk cannot overshoot
                // MAX_CHUNK_BYTES (memory bound is exact).
                let remaining = (MAX_CHUNK_BYTES - body.len() as u64) as usize;
                body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if body.len() as u64 >= MAX_CHUNK_BYTES {
                    break;
                }
            }
            Err(_) => {
                truncated = true;
                break;
            }
        }
    }
    Some(Window {
        status,
        total,
        content_type,
        body,
        truncated,
    })
}

/// Outcome of one upstream window fetch (see [`fetch_window`]).
struct Window {
    status: StatusCode,
    total: Option<u64>,
    content_type: header::HeaderValue,
    body: Vec<u8>,
    truncated: bool,
}

fn simple_response(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(text.as_bytes().to_vec())
        .expect("static response is always valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamped_range_bounds_every_request_shape() {
        let cap = MAX_CHUNK_BYTES - 1;
        assert_eq!(clamped_range(None), (format!("bytes=0-{cap}"), 0));
        assert_eq!(
            clamped_range(Some("bytes=0-")),
            (format!("bytes=0-{cap}"), 0)
        );
        assert_eq!(
            clamped_range(Some("bytes=1048576-")),
            (format!("bytes=1048576-{}", 1048576 + cap), 1048576)
        );
        // Bounded within the cap passes through untouched.
        assert_eq!(
            clamped_range(Some("bytes=100-199")),
            ("bytes=100-199".to_string(), 100)
        );
        // Bounded beyond the cap is clamped to the cap.
        assert_eq!(
            clamped_range(Some("bytes=0-999999999")),
            (format!("bytes=0-{cap}"), 0)
        );
        // Malformed falls back to the first window.
        assert_eq!(
            clamped_range(Some("garbage")),
            (format!("bytes=0-{cap}"), 0)
        );
        // end < start (invalid) falls back to a cap-sized window at start.
        assert_eq!(
            clamped_range(Some("bytes=50-10")),
            (format!("bytes=50-{}", 50 + cap), 50)
        );
        // Absurd start (u64 near max) saturates instead of overflowing.
        assert_eq!(
            clamped_range(Some("bytes=18446744073709551615-")),
            (
                "bytes=18446744073709551615-18446744073709551615".to_string(),
                u64::MAX
            )
        );
    }

    #[tokio::test]
    async fn respond_decodes_percent_encoded_token_path() {
        // convertFileSrc runs encodeURIComponent, so the real webview asks
        // for /preview%2F{token}. A stored token reached through the
        // encoded path must resolve (BAD_GATEWAY from the unreachable
        // fetch target below proves the lookup matched — a decode failure
        // would 404 instead).
        let path = remember_preview_url("BV1test", "http://127.0.0.1:1/v.mp4", None);
        let encoded = format!("/{}", path.replace('/', "%2F"));
        let req = Request::builder().uri(encoded).body(Vec::new()).unwrap();
        let res = respond_inner(req, None).await;
        assert_eq!(res.status(), StatusCode::BAD_GATEWAY);

        // Unknown token stays a 404 through the same decode path.
        let req = Request::builder()
            .uri("/preview%2F00000000000000000000000000000000")
            .body(Vec::new())
            .unwrap();
        let res = respond_inner(req, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn respond_relays_range_request_end_to_end() {
        // End-to-end through the protocol entry point: the request's Range
        // header must survive respond()'s extraction into the upstream fetch
        // (a dropped/misnamed header would clamp to bytes=0-4194303 and miss
        // this matcher).
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/v.mp4"))
            .and(wiremock::matchers::header("Range", "bytes=10-19"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header("Content-Type", "video/mp4")
                    .insert_header("Content-Range", "bytes 10-19/643062260")
                    .insert_header("Content-Length", "10")
                    .set_body_bytes(b"0123456789".to_vec()),
            )
            .expect(1)
            .mount(&server)
            .await;
        let path = remember_preview_url("BV1test", &format!("{}/v.mp4", server.uri()), None);
        let req = Request::builder()
            .uri(format!("/{}", path.replace('/', "%2F")))
            .header(header::RANGE, "bytes=10-19")
            .body(Vec::new())
            .unwrap();
        let res = respond_inner(req, None).await;
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            "video/mp4"
        );
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 10-19/643062260"
        );
        assert_eq!(res.body(), b"0123456789".to_vec().as_slice());
        server.verify().await;
    }

    #[test]
    fn url_deadline_parses_unix_seconds() {
        assert_eq!(
            url_deadline("https://cdn/x.mp4?deadline=1791542225&os=akam"),
            Some(1791542225)
        );
        assert_eq!(url_deadline("https://cdn/x.mp4"), None);
    }

    #[test]
    fn store_roundtrip_expiry_and_pruning() {
        let mut store = PreviewUrlStore::default();
        let t0 = Instant::now();
        // Far-future deadline: stays retrievable.
        let path = store.remember("BV1t", "https://cdn/a.mp4?deadline=9999999999", None, t0);
        let token = path.strip_prefix("preview/").unwrap();
        assert_eq!(
            store.lookup(token, t0 + Duration::from_secs(10)).as_deref(),
            Some("https://cdn/a.mp4?deadline=9999999999")
        );
        // Deadline in the past → fallback TTL applies (still live short-term).
        let short = store.remember("BV1t", "https://cdn/b.mp4?deadline=1000", None, t0);
        let short_token = short.strip_prefix("preview/").unwrap();
        assert!(store
            .lookup(short_token, t0 + Duration::from_secs(10))
            .is_some());
        assert!(store
            .lookup(short_token, t0 + DEFAULT_TOKEN_TTL + Duration::from_secs(1))
            .is_none());
        // Pruning on insert drops expired entries.
        store.remember(
            "BV1t",
            "https://cdn/c.mp4?deadline=9999999999",
            None,
            t0 + DEFAULT_TOKEN_TTL * 2,
        );
        assert!(store
            .lookup(short_token, t0 + DEFAULT_TOKEN_TTL * 2)
            .is_none());
    }

    #[tokio::test]
    async fn relay_range_forwards_status_headers_and_bytes() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/v.mp4"))
            .and(wiremock::matchers::header("Range", "bytes=0-4194303"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header("Content-Type", "video/mp4")
                    .insert_header("Content-Range", "bytes 0-4194303/643062260")
                    .insert_header("Content-Length", "4194304")
                    .insert_header("Accept-Ranges", "bytes")
                    .set_body_bytes(vec![1u8; 4194304]),
            )
            .expect(1)
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let res = relay_range(&client, &format!("{}/v.mp4", server.uri()), None).await;
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-4194303/643062260"
        );
        assert_eq!(
            res.headers().get(header::CONTENT_LENGTH).unwrap(),
            "4194304"
        );
        assert_eq!(res.body().len(), 4194304);
        server.verify().await;
    }

    #[tokio::test]
    async fn relay_range_maps_cdn_failure_to_bad_gateway() {
        // Nothing listens on this port: connection-error path.
        let client = reqwest::Client::new();
        let res = relay_range(&client, "http://127.0.0.1:1/v.mp4", None).await;
        assert_eq!(res.status(), StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn relay_range_caps_a_range_ignoring_200_to_the_chunk_window() {
        // 200 full body beyond the chunk cap (upstream ignored Range):
        // memory stays bounded — the read loop stops at MAX_CHUNK_BYTES
        // and the relay answers with a capped 206 instead of buffering the
        // whole entity (the media element continues from the next window).
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/big.mp4"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_bytes(vec![
                0u8;
                MAX_CHUNK_BYTES
                    as usize
                    + 1
            ]))
            .expect(1)
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let res = relay_range(
            &client,
            &format!("{}/big.mp4", server.uri()),
            Some("bytes=0-"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body().len(), MAX_CHUNK_BYTES as usize);
        assert_eq!(
            res.headers().get(header::CONTENT_LENGTH).unwrap(),
            &MAX_CHUNK_BYTES.to_string()
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn relay_range_serves_truncated_windows_as_partial_206() {
        // The capped-edge shape (measured 2026-10-09): 206 headers promise
        // a full window via Content-Range, the body dies early. The relay
        // must serve the bytes that arrived with a TRUTHFUL rewritten
        // Content-Range/Length instead of surfacing a decode error.
        // wiremock cannot send a Content-Length larger than its body (its
        // hyper server panics on the mismatch), so this drives a raw TCP
        // listener that hand-writes the truncated response.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut conn, _)) = listener.accept() {
                use std::io::{Read, Write};
                let mut buf = [0u8; 1024];
                let _ = conn.read(&mut buf);
                let head = "HTTP/1.1 206 Partial Content\r\n\
                            Content-Type: video/mp4\r\n\
                            Content-Range: bytes 0-4194303/922635671\r\n\
                            Content-Length: 4194304\r\n\
                            Accept-Ranges: bytes\r\n\r\n";
                let _ = conn.write_all(head.as_bytes());
                let _ = conn.write_all(&vec![1u8; 65536]);
                // Drop the connection with 4MB still owed.
            }
        });
        let client = reqwest::Client::new();
        let res = relay_range(
            &client,
            &format!("http://127.0.0.1:{port}/capped.mp4"),
            Some("bytes=0-"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body().len(), 65536);
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-65535/922635671"
        );
        assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "65536");
    }

    #[tokio::test]
    async fn relay_range_retries_zero_byte_windows_on_a_fresh_connection() {
        // The pooled-connection artifact (measured 2026-10-09): the same
        // offset answers 206 with an empty body on the reused keep-alive
        // connection, then serves normally on a fresh one. The raw TCP
        // listener answers the first connection with a zero-body 206 and
        // the second with real bytes.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for round in 0..2 {
                if let Ok((mut conn, _)) = listener.accept() {
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 2048];
                    let _ = conn.read(&mut buf);
                    let head = "HTTP/1.1 206 Partial Content\r\n\
                                Content-Type: video/mp4\r\n\
                                Content-Range: bytes 0-65535/65536\r\n\
                                Content-Length: 65536\r\n\r\n";
                    let _ = conn.write_all(head.as_bytes());
                    if round == 1 {
                        let _ = conn.write_all(&vec![2u8; 65536]);
                    }
                    // round 0 closes owing 65536 bytes (zero-body 206)
                }
            }
        });
        let client = reqwest::Client::new();
        let res = relay_range(
            &client,
            &format!("http://127.0.0.1:{port}/flaky.mp4"),
            Some("bytes=0-"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body().len(), 65536);
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-65535/65536"
        );
    }

    #[test]
    fn rotation_retry_url_follows_the_failed_lane() {
        // Audio-lane rotation must retry the fresh AUDIO URL — relaying
        // the video URL to an <audio> element yields undecodable bytes.
        assert_eq!(
            rotation_retry_url(true, "http://v.m4s", Some("http://a.m4s")).as_deref(),
            Some("http://a.m4s")
        );
        assert_eq!(
            rotation_retry_url(false, "http://v.m4s", Some("http://a.m4s")).as_deref(),
            Some("http://v.m4s")
        );
        // Fresh draw without a separate audio track (durl): the audio
        // lane has nothing to retry on; the video lane always does.
        assert_eq!(rotation_retry_url(true, "http://v.mp4", None), None);
        assert_eq!(
            rotation_retry_url(false, "http://v.mp4", None).as_deref(),
            Some("http://v.mp4")
        );
    }

    #[tokio::test]
    async fn probe_url_passes_exact_windows_and_rejects_short_or_oversized_bodies() {
        let server = wiremock::MockServer::start().await;
        // Healthy edge: exactly the probe window, total larger (so
        // required = PROBE_WINDOW_BYTES).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/exact.m4s"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header(
                        "Content-Range",
                        format!("bytes 0-{}/922635671", PROBE_WINDOW_BYTES - 1),
                    )
                    .set_body_bytes(vec![1u8; PROBE_WINDOW_BYTES as usize]),
            )
            .mount(&server)
            .await;
        // Truncated edge: body dies short of the window (no Content-Range
        // → required stays the full window).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/short.m4s"))
            .respond_with(wiremock::ResponseTemplate::new(206).set_body_bytes(vec![1u8; 64 * 1024]))
            .mount(&server)
            .await;
        // Range-ignoring edge: 200 with a body larger than the window —
        // must be rejected WITHOUT buffering the whole entity.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/ignored.m4s"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_bytes(vec![
                1u8;
                PROBE_WINDOW_BYTES
                    as usize
                    + 32 * 1024
            ]))
            .mount(&server)
            .await;
        assert!(probe_url(&format!("{}/exact.m4s", server.uri())).await);
        assert!(!probe_url(&format!("{}/short.m4s", server.uri())).await);
        assert!(!probe_url(&format!("{}/ignored.m4s", server.uri())).await);
    }
}
