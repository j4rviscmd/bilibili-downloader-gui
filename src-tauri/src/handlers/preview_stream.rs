//! CDN relay + local HLS serving for search-result video previews.
//!
//! Two halves, one store:
//!
//! 1. **Loopback relay** (ffmpeg's input lane): `preview_hls` registers a
//!    resolved CDN URL pair under a token, then ffmpeg streams
//!    `http://127.0.0.1:{port}/cdn/{token}/(video|audio)` from the
//!    in-process hyper server. Mid-stream CDN deaths (per-URL quota,
//!    resets) mark the URL spent and the NEXT request rotates to a fresh
//!    resolve — ffmpeg cannot swap an input URL itself, so all CDN
//!    robustness must live on this side (see the design spec).
//! 2. **`stream://` serving**: the generated HLS artifacts
//!    (`hls/{token}/…`) are served to the webview straight from the
//!    session temp dir; the webview never touches the CDN.
//!
//! Why a relay at all: three measured (2026-10-09) CDN behaviors make a
//! webview-side `<video src="https://cdn...">` unreliable from overseas
//! networks — `Sec-Fetch-Dest: video` hotlink blocks on `og=cos`/`og=hw`,
//! Akamai `hdnts` Referer 403s, and WKWebView HTTP/3 stalls (issue #814).
//! reqwest sidesteps all three (no `Sec-Fetch-*`, no Referer, HTTP/1.1/2
//! only), which is also why `probe_url` (the resolve reroll's dead-edge
//! check) measures with the same client configuration.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;
use tauri::http::{header, HeaderValue, Request, Response, StatusCode};
// hyper/http-body combinators used by the loopback relay (boxed/map_err).
use http_body_util::BodyExt as _;

use crate::constants::USER_AGENT;

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
    /// When a rotation last failed for this token (rotation backoff —
    /// see `begin_rotation`). None = no active backoff.
    rotation_failed_at: Option<Instant>,
    /// True when the current URL died mid-stream or was refused (quota /
    /// reset edges). The next loopback GET rotates before serving.
    spent: bool,
    /// True right after a rotation swapped this pair in. A fresh URL has
    /// no quota history, so its immediate refusal means the family/IP is
    /// unhealthy — that failure starts the rotation backoff (see
    /// `relay_sequential`), instead of hammering resolve in a ~1Hz loop
    /// while a CDN throttle deepens (measured 2026-10-10).
    fresh: bool,
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
                rotation_failed_at: None,
                spent: false,
                // The initial pair passed the resolve probe, so its first
                // GET failure is the per-URL lottery, not family-level.
                fresh: false,
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
            p.rotation_failed_at = None;
            p.spent = false;
            // Rotated-in pairs are probe-free: treat their first death
            // as family-level and start the backoff.
            p.fresh = true;
        }
    }

    /// Marks the token's URL as dead (sequential relay saw the stream fail
    /// or end short) so the next loopback GET rotates before serving.
    fn mark_spent(&mut self, token: &str) {
        if let Some(p) = self.entries.get_mut(token) {
            p.spent = true;
        }
    }

    /// Whether the token's URL is currently marked spent.
    fn is_spent(&self, token: &str) -> bool {
        self.entries.get(token).is_some_and(|p| p.spent)
    }

    /// Clears the fresh flag once a stream starts delivering (the URL
    /// proved itself; later deaths are the ordinary quota lottery).
    fn clear_fresh(&mut self, token: &str) {
        if let Some(p) = self.entries.get_mut(token) {
            p.fresh = false;
        }
    }

    /// Like [`clear_fresh`], but reports whether the flag WAS set — the
    /// relay uses the return to decide whether a refusal deserves the
    /// family-level backoff.
    fn clear_fresh_checked(&mut self, token: &str) -> bool {
        match self.entries.get_mut(token) {
            Some(p) if p.fresh => {
                p.fresh = false;
                true
            }
            _ => false,
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
        !matches!(p.rotation_failed_at, Some(at) if at.elapsed() < ROTATION_BACKOFF)
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

/// Registers a resolved CDN pair and returns the token path
/// (`preview/{token}`); `preview_hls::open_session_with` calls this and
/// derives the loopback/HLS token from it.
pub fn remember_preview_url(bvid: &str, url: &str, audio_url: Option<&str>) -> String {
    let mut guard = lock_store();
    guard.remember(bvid, url, audio_url, Instant::now())
}

fn lock_store() -> std::sync::MutexGuard<'static, PreviewUrlStore> {
    // Poisoning only happens on a panic mid-lock; recovering the inner
    // store keeps previews alive instead of poisoning the protocol forever.
    STORE.lock().unwrap_or_else(|p| p.into_inner())
}

// ---------------------------------------------------------------------------
// Loopback relay (ffmpeg input lane)
// ---------------------------------------------------------------------------

/// Body type of the loopback server's responses: the upstream byte stream
/// piped through without buffering. Custom alias (not BoxBody) because
/// serving only needs `Send` and the reqwest decoder stream is not
/// `Sync`; BoxBody would demand it.
type RelayBody =
    Pin<Box<dyn http_body::Body<Data = hyper::body::Bytes, Error = reqwest::Error> + Send>>;

/// Streaming client for the loopback relay. CONSTRAINT: no total timeout —
/// a full m4s body legitimately takes minutes to arrive; only connection
/// establishment and per-read stalls are bounded (the old windowed
/// `proxy_client` used a 10s total timeout, which would kill long streams).
fn stream_client() -> &'static reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .http1_only()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(20))
            .no_gzip()
            .no_brotli()
            .build()
            .expect("streaming client always builds")
    });
    &CLIENT
}

/// Base URL of the app-wide loopback relay (`http://127.0.0.1:{port}`).
/// OnceLock (not LazyLock) because the value only exists after a runtime
/// bind — the ephemeral port is not known at declaration time.
static LOOPBACK_BASE: OnceLock<String> = OnceLock::new();

/// Ensures the loopback relay server is running and returns its base URL.
/// ffmpeg reads its CDN inputs from `http://127.0.0.1:{port}/cdn/{token}/…`
/// so every CDN behavior (rotation, backoff) stays on the Rust side.
pub fn ensure_loopback(app: &tauri::AppHandle) -> String {
    // get_or_init (not a bare get + set): concurrent first opens must not
    // each bind a listener and leak all but the cached one.
    LOOPBACK_BASE
        .get_or_init(|| {
            let listener = match std::net::TcpListener::bind(("127.0.0.1", 0)) {
                Ok(l) => l,
                Err(e) => {
                    log::error!("[BE] preview_stream: loopback bind failed: {e}");
                    // Empty base → open_session fails with
                    // ERR::PREVIEW_RELAY_UNAVAILABLE (never retried: the
                    // failure is not transient in practice).
                    return String::new();
                }
            };
            let addr = listener.local_addr().expect("bound socket has an addr");
            let app = app.clone();
            // std listener → tokio: set nonblocking then convert (avoids a
            // blocking accept on the async runtime; standard tokio pattern).
            listener.set_nonblocking(true).ok();
            let listener = tokio::net::TcpListener::from_std(listener)
                .expect("nonblocking std listener converts to tokio");
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((socket, _)) = listener.accept().await else {
                        continue;
                    };
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let service = hyper::service::service_fn(move |req| {
                            let app = app.clone();
                            async move {
                                Ok::<_, std::convert::Infallible>(serve_loopback(app, req).await)
                            }
                        });
                        let _ = hyper::server::conn::http1::Builder::new()
                            .serve_connection(hyper_util::rt::TokioIo::new(socket), service)
                            .await;
                    });
                }
            });
            format!("http://{addr}")
        })
        .clone()
}

/// One loopback request: parse `/cdn/{token}/{lane}`, delegate to
/// [`relay_sequential`] with the production rotation closure.
async fn serve_loopback(
    app: tauri::AppHandle,
    req: hyper::Request<hyper::body::Incoming>,
) -> hyper::Response<RelayBody> {
    let path = req.uri().path().to_string();
    let range = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if req.method() != hyper::http::Method::GET {
        return box_body_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "loopback relay accepts GET only",
        );
    }
    let (token, lane_audio) = match parse_cdn_path(&path) {
        Some(pair) => pair,
        None => return box_body_response(StatusCode::NOT_FOUND, "unknown loopback path"),
    };
    let app = &app;
    relay_sequential(&token, lane_audio, range.as_deref(), move |bvid| async move {
        crate::handlers::bilibili::resolve_preview_cdn_url(app, &bvid).await
    })
    .await
}

/// Splits `/cdn/{token}/(video|audio)` into (token, is_audio). `None` for
/// anything else — the loopback server serves exactly these two lanes.
fn parse_cdn_path(path: &str) -> Option<(String, bool)> {
    let rest = path.strip_prefix("/cdn/")?;
    let (token, lane) = rest.split_once('/')?;
    let audio = match lane {
        "video" => false,
        "audio" => true,
        _ => return None,
    };
    Some((token.to_string(), audio))
}

/// Core of the loopback relay: serves one lane sequentially from the CDN.
///
/// - Rotation happens at GET entry when the previous stream marked the URL
///   spent; the `rotate` closure resolves a fresh URL pair (production
///   wires `bilibili::resolve_preview_cdn_url`; tests inject a fake).
/// - The upstream request is one unbounded `Range: bytes=X-` stream — the
///   request pattern the download path has always used (the measured
///   per-URL quota punishes windowed re-requests, not sequential reads).
/// - Mid-body failures end the response early; ffmpeg's `-reconnect*`
///   re-GETs, the spent mark then routes that GET at a fresh URL.
async fn relay_sequential<F, Fut>(
    token: &str,
    lane_audio: bool,
    range_header: Option<&str>,
    rotate: F,
) -> hyper::Response<RelayBody>
where
    // Owned `String` argument: a by-ref closure return would need HRTB
    // bounds the async-fn shape cannot express.
    F: Fn(String) -> Fut,
    Fut: Future<Output = Option<(String, Option<String>)>>,
{
    if lock_store().is_spent(token) {
        if !lock_store().begin_rotation(token) {
            // Rotation backoff active (IP-level throttle) — make ffmpeg
            // back off too instead of hammering the resolve loop.
            return box_body_response(StatusCode::SERVICE_UNAVAILABLE, "rotation backoff");
        }
        let bvid = lock_store().bvid(token);
        let rotated = match bvid {
            Some(b) => rotate(b).await,
            None => None,
        };
        match rotated {
            Some((fresh, fresh_audio)) => {
                log::info!("[BE] preview_stream: rotating spent CDN URL for loopback lane");
                lock_store().rotate(token, &fresh, fresh_audio.as_deref());
            }
            None => {
                lock_store().rotation_failed(token);
                return box_body_response(StatusCode::SERVICE_UNAVAILABLE, "rotation failed");
            }
        }
    }
    let url = if lane_audio {
        lock_store().lookup_audio(token, Instant::now())
    } else {
        lock_store().lookup(token, Instant::now())
    };
    let Some(url) = url else {
        return box_body_response(StatusCode::NOT_FOUND, "preview token not found or expired");
    };
    let offset = range_header
        .and_then(|h| h.strip_prefix("bytes="))
        .and_then(|s| s.split('-').next())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let upstream = stream_client()
        .get(&url)
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::RANGE, format!("bytes={offset}-"))
        .send()
        .await;
    let upstream = match upstream {
        Ok(r) if r.status().as_u16() == 206 || r.status().as_u16() == 200 => {
            lock_store().clear_fresh(token);
            r
        }
        other => {
            log::warn!(
                "[BE] preview_stream: loopback upstream refused (status={:?})",
                other.as_ref().map(|r| r.status().as_u16())
            );
            lock_store().mark_spent(token);
            // A freshly rotated (probe-free) URL refusing immediately is
            // family/IP-level trouble, not the per-URL lottery — start
            // the rotation backoff so ffmpeg's reconnects wait out the
            // window instead of driving a resolve-per-second loop that
            // deepens the very throttle causing it (measured 2026-10-10).
            if lock_store().clear_fresh_checked(token) {
                lock_store().rotation_failed(token);
            }
            return box_body_response(StatusCode::BAD_GATEWAY, "preview CDN stream refused");
        }
    };
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();
    // Expected remaining bytes from Content-Range ("bytes X-(total-1)/total")
    // — the yardstick for detecting a cleanly-truncated body (capped edges
    // send fewer bytes then EOF without an error).
    let expected = upstream
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|total| total.saturating_sub(offset));
    let marker = SpentMarker {
        inner: upstream.bytes_stream(),
        token: token.to_string(),
        sent: 0,
        expected,
    };
    let mut builder = hyper::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type);
    if let Some(expected) = expected {
        builder = builder.header(header::CONTENT_LENGTH, expected);
    }
    builder
        .body(Box::pin(http_body_util::StreamBody::new(marker)) as RelayBody)
        .unwrap_or_else(|_| box_body_response(StatusCode::BAD_GATEWAY, "invalid relay headers"))
}

/// Wraps the upstream chunk stream: counts delivered bytes and marks the
/// token spent when the transfer errors or ends short of the expected
/// length (capped-edge truncation). The next ffmpeg reconnect then hits
/// the rotation path in [`relay_sequential`].
struct SpentMarker<S> {
    inner: S,
    token: String,
    sent: u64,
    expected: Option<u64>,
}

impl<S> futures::Stream for SpentMarker<S>
where
    S: futures::Stream<Item = reqwest::Result<hyper::body::Bytes>> + Unpin,
{
    type Item = reqwest::Result<http_body::Frame<hyper::body::Bytes>>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match futures::StreamExt::poll_next_unpin(&mut self.inner, cx) {
            Poll::Ready(Some(Ok(chunk))) => {
                self.sent += chunk.len() as u64;
                Poll::Ready(Some(Ok(http_body::Frame::data(chunk))))
            }
            Poll::Ready(Some(Err(e))) => {
                log::info!("[BE] preview_stream: loopback stream error mid-body: {e}");
                lock_store().mark_spent(&self.token);
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                if self.expected.is_some_and(|e| self.sent < e) {
                    log::info!(
                        "[BE] preview_stream: loopback stream ended short ({} of {:?} bytes) — marking spent",
                        self.sent,
                        self.expected
                    );
                    lock_store().mark_spent(&self.token);
                }
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Small text response for the loopback server (errors / control paths).
fn box_body_response(status: StatusCode, text: &str) -> hyper::Response<RelayBody> {
    hyper::Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Box::pin(
            http_body_util::Full::new(hyper::body::Bytes::from(text.as_bytes().to_vec()))
                .map_err(|never| -> reqwest::Error { match never {} }),
        ) as RelayBody)
        .expect("static response is always valid")
}

/// Test/app seam for [`relay_sequential`]: parses a loopback path and
/// collects the streamed body into a plain response (the production
/// hyper path streams the same bytes without collecting).
pub async fn handle_cdn_request<F, Fut>(
    path: &str,
    range_header: Option<&str>,
    rotate: F,
) -> Response<Vec<u8>>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Option<(String, Option<String>)>>,
{
    let Some((token, lane_audio)) = parse_cdn_path(path) else {
        return simple_response(StatusCode::NOT_FOUND, "unknown loopback path");
    };
    let resp = relay_sequential(&token, lane_audio, range_header, rotate).await;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let body = match http_body_util::BodyExt::collect(resp.into_body()).await {
        Ok(collected) => collected.to_bytes().to_vec(),
        Err(_) => Vec::new(),
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .expect("collected response is always valid")
}

/// Serves one generated HLS artifact: `{token}/{file}` where file is
/// whitelisted (playlist.m3u8 / init.mp4 / segNNN.m4s). The token charset
/// check plus the whitelist make traversal structurally impossible.
pub(crate) async fn serve_hls_path(rest: &str) -> Response<Vec<u8>> {
    let Some((token, file)) = rest.split_once('/') else {
        return simple_response(StatusCode::NOT_FOUND, "malformed hls path");
    };
    let token_ok = token.len() == 32 && token.chars().all(|c| c.is_ascii_hexdigit());
    if !token_ok {
        return simple_response(StatusCode::NOT_FOUND, "unknown hls token");
    }
    let file_ok = matches!(file, "playlist.m3u8" | "init.mp4")
        || (file.starts_with("seg")
            && file.ends_with(".m4s")
            && file[3..file.len() - 4].chars().all(|c| c.is_ascii_digit()));
    if !file_ok {
        return simple_response(StatusCode::NOT_FOUND, "unknown hls artifact");
    }
    let Some(dir) = crate::handlers::preview_hls::session_dir(token) else {
        return simple_response(StatusCode::NOT_FOUND, "preview session not found");
    };
    let mime = match file {
        "playlist.m3u8" => "application/vnd.apple.mpegurl",
        "init.mp4" => "video/mp4",
        _ => "video/iso.segment",
    };
    // Segments appear as ffmpeg writes them; a not-yet-written segment
    // is a normal race the player retries through. The PLAYLIST is
    // special: hls.js treats a manifest 404 as immediately fatal (4xx is
    // never retried — retryForHttpStatus in hls.js; a synthetic empty
    // playlist is equally fatal via levelEmptyError — both measured
    // 2026-10-10), so the route HOLDS the request until ffmpeg writes
    // the real file (long-poll bridging the generation warm-up). On
    // timeout the 404 stands: a playlist that never appears means the
    // remux died, and the FE hears preview-hls-error separately.
    const PLAYLIST_POLL_MS: u64 = 200;
    const PLAYLIST_POLL_MAX_MS: u64 = 25_000;
    let path = dir.join(file);
    if file == "playlist.m3u8" {
        let mut waited = 0u64;
        loop {
            if let Ok(bytes) = tokio::fs::read(&path).await {
                return hls_ok_response(mime, rewrite_playlist_urls(&bytes, token));
            }
            if waited >= PLAYLIST_POLL_MAX_MS {
                return simple_response(StatusCode::NOT_FOUND, "hls artifact not ready");
            }
            tokio::time::sleep(Duration::from_millis(PLAYLIST_POLL_MS)).await;
            waited += PLAYLIST_POLL_MS;
        }
    }
    match tokio::fs::read(&path).await {
        Ok(bytes) => hls_ok_response(mime, bytes),
        Err(_) => simple_response(StatusCode::NOT_FOUND, "hls artifact not ready"),
    }
}

/// Rewrites the playlist's relative artifact references to absolute
/// `/hls/{token}/…` paths. convertFileSrc percent-encodes the WHOLE path
/// (`hls%2F{token}%2Fplaylist.m3u8` — one URL segment), so RFC-3986
/// relative resolution sends `seg000.m4s` to the server ROOT, not into
/// the session; ffmpeg's EXT-X-MAP URI carries the ABSOLUTE Windows
/// init-segment path (both measured: fragment fetches status 0).
fn rewrite_playlist_urls(bytes: &[u8], token: &str) -> Vec<u8> {
    let body = String::from_utf8_lossy(bytes).into_owned();
    let prefix = format!("/hls/{token}/");
    // Any URI="…init.mp4" value (relative or absolute) → session path.
    let mut out = String::with_capacity(body.len());
    let mut rest = body.as_str();
    while let Some(start) = rest.find("URI=\"") {
        let value_start = start + 5;
        let Some(rel) = rest[value_start..].find('"') else {
            break;
        };
        let value_end = value_start + rel;
        let value = &rest[value_start..value_end];
        out.push_str(&rest[..value_start]);
        if value.ends_with("init.mp4") {
            out.push_str(&format!("{prefix}init.mp4"));
        } else {
            out.push_str(value);
        }
        out.push('"');
        rest = &rest[value_end + 1..];
    }
    out.push_str(rest);
    out.replace("\nseg", &format!("\n{prefix}seg")).into_bytes()
}

fn hls_ok_response(mime: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .body(bytes)
        .expect("static response is always valid")
}

/// Entry point for the `stream://` protocol handler (lib.rs registration).
pub async fn respond(_app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    respond_inner(request).await
}

/// Core of [`respond`]: serves the generated-HLS artifact routes. The CDN
/// is never touched here — ffmpeg reads it through the loopback relay and
/// only generated files reach the webview.
async fn respond_inner(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // convertFileSrc percent-encodes the whole path (encodeURIComponent),
    // so the webview requests /hls%2F{token}%2Ffile — decode before the
    // prefix strip or the route never matches (same decode tauri's asset
    // protocol performs on its paths).
    let path = percent_decode_str(request.uri().path()).decode_utf8_lossy();
    let mut response = if let Some(rest) = path.strip_prefix("/hls/") {
        serve_hls_path(rest).await
    } else {
        simple_response(StatusCode::NOT_FOUND, "unknown stream path")
    };
    // hls.js loads the playlist/segments with XHR, and the app page and this
    // `stream://` origin always differ (Windows: `http://tauri.localhost` vs
    // `http://stream.localhost`; elsewhere `tauri://` vs `stream://`), so a
    // custom-protocol handler MUST answer CORS itself (see the tauri Builder
    // docs for register_uri_scheme_protocol). `*` is safe here: the route is
    // token-gated and reachable only from the app webview.
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
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

    // Sequential relay: one unbounded Range stream per GET, offset from the
    // client's Range header forwarded upstream unchanged.
    #[tokio::test]
    async fn loopback_streams_body_and_forwards_range_offset() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/up.m4s"))
            .and(wiremock::matchers::header("Range", "bytes=100-"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header("Content-Type", "video/mp4")
                    .insert_header("Content-Range", "bytes 100-109/110")
                    .set_body_bytes(b"ABCDEFGHIJ".to_vec()),
            )
            .mount(&server)
            .await;
        let path = remember_preview_url("bvid", &format!("{}/up.m4s", server.uri()), None);
        let token = path.trim_start_matches("preview/").to_string();
        let resp = handle_cdn_request(
            &format!("/cdn/{token}/video"),
            Some("bytes=100-"),
            |_| async { Option::<(String, Option<String>)>::None },
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "video/mp4"
        );
        assert_eq!(resp.body(), b"ABCDEFGHIJ");
    }

    // Mid-body death marks the lane spent; the NEXT GET rotates and serves
    // from the fresh URL (this composition is what survives per-URL quota).
    #[tokio::test]
    async fn loopback_marks_spent_and_rotates_on_next_get() {
        let server = wiremock::MockServer::start().await;
        // First URL: delivers a short body then closes early — a 206 whose
        // declared range promises more than arrives (capped-edge shape).
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/spent.m4s"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header("Content-Type", "video/mp4")
                    .insert_header("Content-Range", "bytes 0-99/1000")
                    .set_body_bytes(vec![7u8; 100]),
            )
            .mount(&server)
            .await;
        // Fresh URL after rotation: serves the offset ffmpeg asks for.
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/fresh.m4s"))
            .and(wiremock::matchers::header("Range", "bytes=100-"))
            .respond_with(
                wiremock::ResponseTemplate::new(206)
                    .insert_header("Content-Type", "video/mp4")
                    .insert_header("Content-Range", "bytes 100-149/1000")
                    .set_body_bytes(b"FRESH".to_vec()),
            )
            .mount(&server)
            .await;
        let fresh = format!("{}/fresh.m4s", server.uri());
        let path = remember_preview_url("bvid", &format!("{}/spent.m4s", server.uri()), None);
        let token = path.trim_start_matches("preview/").to_string();

        // First GET: full (short) body served; the SpentMarker sees the
        // declared 1000-byte total and marks the URL spent on clean EOF.
        let first = handle_cdn_request(&format!("/cdn/{token}/video"), None, |_| async {
            Option::<(String, Option<String>)>::None
        })
        .await;
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(first.body().len(), 100);

        // Second GET: rotation closure hands the fresh URL, served from the
        // requested offset.
        let second = handle_cdn_request(&format!("/cdn/{token}/video"), Some("bytes=100-"), {
            let fresh = fresh.clone();
            move |_| {
                let fresh = fresh.clone();
                async move { Some((fresh.clone(), None)) }
            }
        })
        .await;
        assert_eq!(second.status(), StatusCode::OK);
        assert_eq!(second.body(), b"FRESH");
    }

    // Unknown tokens and non-lane paths never reach the CDN: the relay
    // answers them from the store/parser alone.
    #[tokio::test]
    async fn loopback_rejects_unknown_token_and_unknown_paths() {
        let unknown = handle_cdn_request(
            "/cdn/00112233445566778899aabbccddeeff/video",
            None,
            |_| async { Option::<(String, Option<String>)>::None },
        )
        .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(unknown.body(), b"preview token not found or expired");

        // Only `/cdn/{token}/(video|audio)` exists on the loopback server.
        let bad_path = handle_cdn_request("/cdn/token/thumbnail", None, |_| async {
            Option::<(String, Option<String>)>::None
        })
        .await;
        assert_eq!(bad_path.status(), StatusCode::NOT_FOUND);
        assert_eq!(bad_path.body(), b"unknown loopback path");
    }

    // durl/muxed previews store no audio URL; ffmpeg only asks for the
    // audio lane on DASH draws, but a stale request must 404 rather than
    // silently serve the video track twice.
    #[tokio::test]
    async fn loopback_audio_lane_404s_without_a_stored_audio_url() {
        let path = remember_preview_url("bvid", "http://127.0.0.1:1/muxed.mp4", None);
        let token = path.trim_start_matches("preview/").to_string();
        let resp = handle_cdn_request(&format!("/cdn/{token}/audio"), None, |_| async {
            Option::<(String, Option<String>)>::None
        })
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // Rotation admission: a failed resolve starts the backoff window so a
    // throttled network cannot amplify its own risk control by re-running
    // the multi-attempt resolve loop on every ffmpeg reconnect; once the
    // window lapses the next GET rotates and serves again.
    #[tokio::test]
    async fn loopback_rotation_failure_backs_off_then_recovers() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/fresh.m4s"))
            .respond_with(wiremock::ResponseTemplate::new(206).set_body_bytes(b"FRESH".to_vec()))
            .mount(&server)
            .await;
        let fresh = format!("{}/fresh.m4s", server.uri());
        let path = remember_preview_url("bvid", "http://127.0.0.1:1/dead.m4s", None);
        let token = path.trim_start_matches("preview/").to_string();
        lock_store().mark_spent(&token);

        // Resolve exhausted (IP-level throttle): 503 + the window opens.
        let failed = handle_cdn_request(&format!("/cdn/{token}/video"), None, |_| async {
            Option::<(String, Option<String>)>::None
        })
        .await;
        assert_eq!(failed.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(failed.body(), b"rotation failed");

        // Inside the window the relay must not even call the resolve
        // closure — that is the amplification this guards against.
        let calls = Arc::new(AtomicUsize::new(0));
        let sneaky = handle_cdn_request(&format!("/cdn/{token}/video"), None, {
            let calls = Arc::clone(&calls);
            let fresh = fresh.clone();
            move |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                let fresh = fresh.clone();
                async move { Some((fresh, None)) }
            }
        })
        .await;
        assert_eq!(sneaky.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(sneaky.body(), b"rotation backoff");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "backoff must suppress the resolve loop"
        );

        // Backdate the failure past ROTATION_BACKOFF: admitted again.
        // (Simulated by moving the recorded timestamp, not by sleeping —
        // the subtraction underflows only on a machine booted within the
        // backoff window, where CI/local machines realistically never run.)
        let lapsed = Instant::now()
            .checked_sub(ROTATION_BACKOFF + Duration::from_secs(1))
            .expect("machine uptime exceeds the backoff window");
        lock_store()
            .entries
            .get_mut(&token)
            .expect("token still stored")
            .rotation_failed_at = Some(lapsed);
        let recovered = handle_cdn_request(&format!("/cdn/{token}/video"), None, {
            let fresh = fresh.clone();
            move |_| {
                let fresh = fresh.clone();
                async move { Some((fresh, None)) }
            }
        })
        .await;
        assert_eq!(recovered.status(), StatusCode::OK);
        assert_eq!(recovered.body(), b"FRESH");
    }

    // A refused upstream (quota 403/503, connection reset) ends the lane:
    // 502 tells ffmpeg to reconnect, and the spent mark routes that
    // reconnect at the rotation path.
    #[tokio::test]
    async fn loopback_maps_refused_upstream_to_502_and_marks_spent() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/refused.m4s"))
            .respond_with(wiremock::ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let path = remember_preview_url("bvid", &format!("{}/refused.m4s", server.uri()), None);
        let token = path.trim_start_matches("preview/").to_string();
        let resp = handle_cdn_request(&format!("/cdn/{token}/video"), None, |_| async {
            Option::<(String, Option<String>)>::None
        })
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        assert!(
            lock_store().is_spent(&token),
            "a refused upstream must mark the URL spent"
        );
    }

    // A probe-free freshly rotated URL refusing immediately is family-
    // level trouble: the refusal must start the rotation backoff so the
    // next GET answers 503 (waiting out the window) instead of driving a
    // resolve-per-second loop into a deepening CDN throttle.
    #[tokio::test]
    async fn loopback_backs_off_when_a_freshly_rotated_url_refuses() {
        let server = wiremock::MockServer::start().await;
        for file in ["/initial.m4s", "/fresh.m4s"] {
            wiremock::Mock::given(wiremock::matchers::method("GET"))
                .and(wiremock::matchers::path(file))
                .respond_with(wiremock::ResponseTemplate::new(503))
                .mount(&server)
                .await;
        }
        let fresh = format!("{}/fresh.m4s", server.uri());
        let path = remember_preview_url("bvid", &format!("{}/initial.m4s", server.uri()), None);
        let token = path.trim_start_matches("preview/").to_string();
        let no_rotate = |_| async { Option::<(String, Option<String>)>::None };

        // Initial (probed) URL dies: per-URL lottery, no backoff yet.
        let first = handle_cdn_request(&format!("/cdn/{token}/video"), None, no_rotate).await;
        assert_eq!(first.status(), StatusCode::BAD_GATEWAY);

        // Next GET rotates (resolve ok) but the fresh URL also refuses:
        // family-level → rotation_failed → backoff window opens.
        let second = handle_cdn_request(&format!("/cdn/{token}/video"), None, {
            let fresh = fresh.clone();
            move |_| {
                let fresh = fresh.clone();
                async move { Some((fresh.clone(), None)) }
            }
        })
        .await;
        assert_eq!(second.status(), StatusCode::BAD_GATEWAY);

        // Within the backoff window the relay refuses to rotate: ffmpeg
        // sees 503 and retries later instead of a resolve storm.
        let third = handle_cdn_request(&format!("/cdn/{token}/video"), None, |_| async {
            panic!("rotation closure must not run during the backoff window")
        })
        .await;
        assert_eq!(third.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    // The HLS route rejects malformed tokens, traversal-shaped filenames,
    // and unregistered sessions before touching the filesystem.
    #[tokio::test]
    async fn hls_route_rejects_bad_token_and_file_names() {
        let not_hex = serve_hls_path("nothex/playlist.m3u8").await;
        assert_eq!(not_hex.status(), StatusCode::NOT_FOUND);
        let traversal = serve_hls_path("00112233445566778899aabbccddeeff/../../secret").await;
        assert_eq!(traversal.status(), StatusCode::NOT_FOUND);
        let bad_file = serve_hls_path("00112233445566778899aabbccddeeff/other.m3u8").await;
        assert_eq!(bad_file.status(), StatusCode::NOT_FOUND);
        // Whitelisted file, valid charset, but no live session: 404.
        let missing = serve_hls_path("00112233445566778899aabbccddeeff/playlist.m3u8").await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    // convertFileSrc percent-encodes the whole path (encodeURIComponent),
    // so the webview requests /hls%2F{token}%2Ffile; without the decode the
    // prefix strip never matches and every artifact 404s as an unknown
    // stream path. The CORS header is required because the app page and
    // the stream:// origin always differ (hls.js fetches with XHR).
    #[tokio::test]
    async fn stream_route_percent_decodes_paths_and_answers_cors() {
        let request = Request::builder()
            .uri("/hls%2F00112233445566778899aabbccddeeff%2Fplaylist.m3u8")
            .body(Vec::new())
            .unwrap();
        let decoded = respond_inner(request).await;
        // Reaching the hls-route 404 body (rather than the unknown-stream
        // one) is the proof the decode happened before the prefix strip.
        assert_eq!(
            String::from_utf8_lossy(decoded.body()),
            "preview session not found"
        );
        assert_eq!(
            decoded
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "*"
        );

        let unknown =
            respond_inner(Request::builder().uri("/nope").body(Vec::new()).unwrap()).await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            String::from_utf8_lossy(unknown.body()),
            "unknown stream path"
        );
        assert_eq!(
            unknown
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "*"
        );
    }

    // convertFileSrc collapses the path into one percent-encoded URL
    // segment; relative playlist references must therefore be rewritten
    // to absolute /hls/{token}/ paths or every fragment fetch lands on
    // the server root (status 0, measured 2026-10-10).
    // convertFileSrc collapses the path into one percent-encoded URL
    // segment; relative playlist references must therefore be rewritten
    // to absolute /hls/{token}/ paths or every fragment fetch lands on
    // the server root (status 0, measured 2026-10-10).
    #[test]
    fn rewrite_playlist_urls_points_artifacts_at_the_session() {
        let playlist = concat!(
            "#EXTM3U\n",
            "#EXT-X-MAP:URI=\"init.mp4\"\n",
            "#EXTINF:5.0,\n",
            "seg000.m4s\n",
            "#EXTINF:5.0,\n",
            "seg001.m4s\n",
        );
        let out = String::from_utf8(rewrite_playlist_urls(
            playlist.as_bytes(),
            "00112233445566778899aabbccddeeff",
        ))
        .unwrap();
        assert!(out.contains("URI=\"/hls/00112233445566778899aabbccddeeff/init.mp4\""));
        assert!(out.contains("\n/hls/00112233445566778899aabbccddeeff/seg000.m4s"));
        assert!(out.contains("\n/hls/00112233445566778899aabbccddeeff/seg001.m4s"));
        // ffmpeg writes the ABSOLUTE init path into EXT-X-MAP when
        // -hls_fmp4_init_filename is absolute — any value ending in
        // init.mp4 must be rewritten to the session path.
        let absolute = concat!(
            "#EXTM3U\n",
            "#EXT-X-MAP:URI=\"C:\\Users\\x\\bilibili-dl-preview\\t\\init.mp4\"\n",
            "#EXTINF:5.0,\n",
            "seg000.m4s\n",
        );
        let out2 = String::from_utf8(rewrite_playlist_urls(
            absolute.as_bytes(),
            "00112233445566778899aabbccddeeff",
        ))
        .unwrap();
        assert!(out2.contains("URI=\"/hls/00112233445566778899aabbccddeeff/init.mp4\""));
    }
}
