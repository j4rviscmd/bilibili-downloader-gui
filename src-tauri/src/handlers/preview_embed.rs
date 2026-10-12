//! Official-page preview: plays search-result previews through
//! Bilibili's real video page (`www.bilibili.com/video/…`) in a child
//! webview embedded in the main window, overlaid on the preview
//! dialog's video area.
//!
//! Why an in-window child webview and not a separate OS window: a second
//! window shows up as its own entry in window-level app switchers (AltTab
//! & co. — tao's skip_taskbar is unimplemented on macOS), loses z-order to
//! the main window on activation (reported 2026-10-12: focusing the main
//! window left the video area black), and needs screen-space geometry
//! tracking. As a sibling webview inside the main window there is exactly
//! one app window: switchers, Mission Control, fullscreen and z-order all
//! follow the main window by construction, and bounds are window-relative.
//!
//! Why a separate webview and not an in-page iframe: the WebView2 runtime
//! blocks third-party frames from touching cookies at the engine level
//! (measured 2026-10-11 — `document.cookie` stays empty and the page's
//! APIs answer logged-out even with Edge tracking prevention disabled),
//! so an embedded iframe can never authenticate. As a top-level document
//! the page is first-party: the stored session cookies log it in.
//!
//! Why the video page and not the official embed player
//! (`player.bilibili.com/player.html`): the embed's quality menu does
//! not switch (clicks land but no playurl request is issued, `qn` URL
//! params are ignored) and after that interaction its click handlers
//! stick (center-click play/pause goes dead until reload) — measured
//! 2026-10-11 with input delivery verified correct at every layer. The
//! full page has none of these quirks.

use crate::handlers::bilibili::{fetch_wbi_view, BiliApi};
use crate::handlers::cookie::read_cookie;
use tauri::Manager;

/// Official video page URL for one preview target. The bvid is validated
/// because it is interpolated into a URL — search entries are ours, but
/// the trust boundary is here. `page` appends `?p=N` for multi-part
/// videos (part > 1), mirroring the frontend `buildVideoUrl`.
pub fn video_page_url(bvid: &str, page: Option<i32>) -> Result<String, String> {
    let body_ok = bvid.len() == 12
        && bvid.starts_with("BV")
        && bvid[2..].bytes().all(|b| b.is_ascii_alphanumeric());
    if !body_ok {
        return Err(format!("ERR::INVALID_BVID: {bvid}"));
    }
    let page_query = page
        .filter(|p| *p > 1)
        .map(|p| format!("?p={p}"))
        .unwrap_or_default();
    Ok(format!("https://www.bilibili.com/video/{bvid}{page_query}"))
}

/// A rect in CSS/logical pixels relative to the main webview viewport,
/// measured by the dialog from its placeholder element.
#[derive(Debug, Clone, Copy)]
pub struct OverlayRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Bounds for the overlay webview inside the main window, in logical px.
/// The dialog measures the placeholder in CSS px relative to the main
/// webview's viewport, while the webview's coordinate origin is the
/// window's content-view top-left — on macOS that sits the title-bar
/// inset above the CSS viewport's (0,0) (see `titlebar_inset_physical`);
/// other platforms share the origin, so callers pass 0.
pub fn overlay_bounds(rect: OverlayRect, titlebar_inset_logical: f64) -> tauri::Rect {
    tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(
            rect.x,
            rect.y + titlebar_inset_logical,
        )),
        size: tauri::Size::Logical(tauri::LogicalSize::new(rect.width, rect.height)),
    }
}

/// Current overlay bounds for `rect`: reads the scale factor and (macOS)
/// title-bar inset fresh on every call so monitor moves and fullscreen
/// transitions re-derive the offset.
fn overlay_bounds_for(main: &tauri::Window, rect: OverlayRect) -> Result<tauri::Rect, String> {
    #[cfg(target_os = "macos")]
    {
        let scale = main.scale_factor().map_err(|e| e.to_string())?;
        let inset = titlebar_inset_physical(main, scale)? as f64 / scale;
        Ok(overlay_bounds(rect, inset))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = main;
        Ok(overlay_bounds(rect, 0.0))
    }
}

/// Session cookie pairs to mirror into the webview, filtered to the
/// Bilibili domain (the Firefox import may carry other hosts).
pub fn bilibili_cookie_pairs(
    entries: &[crate::models::cookie::CookieEntry],
) -> Vec<(String, String)> {
    entries
        .iter()
        .filter(|e| {
            // Why: a Firefox-imported host may carry a leading dot and/or a
            // different case, so normalize both before matching the domain.
            e.host
                .trim_start_matches('.')
                .eq_ignore_ascii_case("bilibili.com")
        })
        .map(|e| (e.name.clone(), e.value.clone()))
        .collect()
}

/// Mirrors the stored Bilibili session into the webview cookie store so
/// the first-party player webview authenticates as the logged-in user.
/// Returns the injected pair count (0 when logged out — the player then
/// degrades to anonymous quality, which still plays).
///
/// Windows uses the WebView2 CookieManager directly: tauri's `set_cookie`
/// loses the domain dot and produces host-only cookies the player
/// subdomain never receives (measured 2026-10-11 — see the module docs).
pub fn inject_session_cookies(app: &tauri::AppHandle) -> Result<usize, String> {
    let entries = crate::handlers::cookie::read_cookie(app)?.unwrap_or_default();
    let pairs = bilibili_cookie_pairs(&entries);
    if pairs.is_empty() {
        return Ok(0);
    }
    // Why get_webview and not get_webview_window: once the preview-player
    // child webview is attached to the main window (i.e. after the first
    // preview; it is kept and reused, see close_preview_player), tauri's
    // is_webview_window check — "every webview on this window shares the
    // window's label" — fails and get_webview_window("main") returns None,
    // making every later open fail with ERR::PREVIEW_NO_MAIN_WINDOW
    // (measured 2026-10-12, tauri 2.11.1). The webview registry lookup is
    // immune to sibling webviews.
    let main = app
        .get_webview("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    #[cfg(windows)]
    inject_pairs_win(&main, &pairs)?;
    #[cfg(not(windows))]
    inject_pairs_portable(&main, &pairs)?;
    Ok(pairs.len())
}

/// Windows: domain cookies (`.bilibili.com`) via the WebView2
/// CookieManager COM API.
#[cfg(windows)]
fn inject_pairs_win(webview: &tauri::Webview, pairs: &[(String, String)]) -> Result<(), String> {
    let pairs = pairs.to_vec();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    webview
        .with_webview(move |pw| {
            let result = (|| -> Result<(), String> {
                use webview2_com::Microsoft::Web::WebView2::Win32 as w32;
                use windows_core::Interface;

                let controller = pw.controller();
                let core = unsafe { controller.CoreWebView2() }.map_err(|e| e.to_string())?;
                let core2: w32::ICoreWebView2_2 = core.cast().map_err(|e| e.to_string())?;
                let manager = unsafe { core2.CookieManager() }.map_err(|e| e.to_string())?;
                let domain = windows_core::HSTRING::from(".bilibili.com");
                let path = windows_core::HSTRING::from("/");
                for (name, value) in pairs {
                    let n = windows_core::HSTRING::from(name.as_str());
                    let v = windows_core::HSTRING::from(value.as_str());
                    let cookie = unsafe { manager.CreateCookie(&n, &v, &domain, &path) }
                        .map_err(|e| e.to_string())?;
                    unsafe { manager.AddOrUpdateCookie(&cookie) }.map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| e.to_string())?
}

/// macOS/Linux: tauri's `set_cookie` (WKHTTPCookieStore / soup cookie
/// jar). Domain-dot behavior on these engines is a live-verification
/// item (macOS e2e); worst case the player degrades to anonymous.
#[cfg(not(windows))]
fn inject_pairs_portable(
    webview: &tauri::Webview,
    pairs: &[(String, String)],
) -> Result<(), String> {
    for (name, value) in pairs {
        let cookie = tauri::webview::cookie::Cookie::build((name.as_str(), value.as_str()))
            .domain(".bilibili.com")
            .path("/")
            .secure(true)
            .build();
        webview.set_cookie(cookie).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Serialized rect from the webview (CSS px relative to the viewport).
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct OverlayRectDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn to_rect(dto: OverlayRectDto) -> OverlayRect {
    OverlayRect {
        x: dto.x,
        y: dto.y,
        width: dto.width,
        height: dto.height,
    }
}

/// Title-bar height of the main window in physical px: NSWindow frame
/// height minus contentLayoutRect height. The overlay webview's origin
/// is the window's content-view top (full-size content view), while the
/// main webview's CSS viewport starts this inset lower (measured
/// 2026-10-11: CSS (0,0) sits 64 physical px below the frame top), so
/// the overlay's y offset within the window adds this inset. Tracks
/// fullscreen (inset 0) for free. Runs on the main thread — AppKit
/// getters must not be called from worker threads (reached from async
/// commands).
#[cfg(target_os = "macos")]
fn titlebar_inset_physical(main: &tauri::Window, scale: f64) -> Result<i32, String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    let app = main.app_handle().clone();
    let main = main.clone();
    app.run_on_main_thread(move || {
        use objc2_app_kit::NSWindow;
        let inset = (|| -> i32 {
            let Ok(raw) = main.ns_window() else {
                return 0;
            };
            if raw.is_null() {
                return 0;
            }
            let ns: &NSWindow = unsafe { &*(raw as *const NSWindow) };
            let frame = ns.frame();
            let layout = unsafe { ns.contentLayoutRect() };
            // Why: frame()/contentLayoutRect() report AppKit points,
            // not physical px — multiplying by scale is the
            // points→physical conversion.
            ((frame.size.height - layout.size.height) * scale).round() as i32
        })();
        let _ = tx.send(inset);
    })
    .map_err(|e| e.to_string())?;
    // Why: a plain recv() would hang forever if the main thread never
    // services the closure. The cap degrades that case to an Err instead.
    rx.recv_timeout(std::time::Duration::from_secs(1))
        .map_err(|e| e.to_string())
}

/// Webview label of the overlay (single instance; retargeted per video).
const PREVIEW_PLAYER_LABEL: &str = "preview-player";

/// Runs in the overlay webview at document-created — registered as the
/// builder's `initialization_script` (WebView2:
/// `AddScriptToExecuteOnDocumentCreated`, which wry registers before
/// the first navigation; WKWebView/webkitgtk: user scripts). It
/// therefore executes before any page script and before the first
/// paint, on EVERY top-level navigation: the initial load and each
/// `location.replace` retarget alike. It strips the video page chrome
/// so the overlay shows the player only, full-bleed.
///
/// History: an earlier version applied this script through a timer
/// burst of post-navigation evals, which races the page's first paint —
/// the raw page stayed visible for the gap until the next eval landed
/// (user report 2026-10-11). A first `initialization_script` attempt
/// had measured "never fired" (2026-10-11), but the delivery was fine
/// and the script body was not: at document-created the parser has not
/// produced <html> yet, so the old body's appendChild/MutationObserver
/// calls threw immediately and left no marker. The body is now
/// document-start-safe (root-poll install at the tail).
///
/// Dead end — do not retry: installing the styles via `document.write`
/// into the pre-parse input stream (to beat the first paint by
/// construction) starves the parser in WebView2 — flakily: sometimes
/// the network HTML never parses and the document sits in
/// readyState 'loading' forever (measured 2026-10-12 via a
/// WebMessageReceived state beacon; the same build could also load
/// fine). The root poll lands within ~4ms of <html> existing, which
/// beat the first paint on every observed load.
///
/// The script is idempotent; the MutationObserver re-applies after
/// bilibili's SPA hydration churns the DOM. The player is never
/// restyled — its own mini-mode close control and its own
/// web-fullscreen toggle get clicked instead. A page-level loading
/// cover (black + spinner) hides everything until that switch has
/// happened and the first video frame has been presented (frame gate
/// at the tail of the script; see there for the Windows artifact it
/// hides).
///
/// Why hide page chrome instead of a player-only URL: the official
/// embed player and the blackboard html5player both render a broken
/// quality menu (items gated/no switch — measured 2026-10-11), while
/// the real video page's player is fully functional. Selectors are
/// bilibili's page classes — a redesign degrades to showing the page
/// again, never to a broken player.
const HIDE_VIDEO_PAGE_CHROME: &str = r#"(() => {
  /* Main frame only: WebView2's document-created hook (unlike the eval
     delivery this replaced) injects this script into every subframe as
     well, and the reveal logic below assumes the top-level video page —
     a subframe would sit on the loading cover until the 25s fallback. */
  if (window !== window.top) return;
  /* Esc relay (Windows builds): while the player webview holds
     keyboard focus, Esc never reaches the app's main webview, so the
     preview dialog cannot close on it. Forward the key to the Rust host
     via WebView2 host messaging; it re-emits the preview:esc tauri
     event the dialog closes on. window.chrome.webview exists only
     under WebView2, so other platforms see a dead no-op. Skipped while
     the player is in real fullscreen — the browser consumes that Esc
     itself to exit fullscreen, and only the next Esc closes the
     preview. Capture phase so the player's own stopPropagation cannot
     swallow the key first. */
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        window.chrome?.webview?.postMessage('preview:esc');
      }
    },
    true,
  );
  const css = `
    #biliMainHeader, .right-container, .video-info-container, #danmukuBox,
    .video-toolbar-container, #commentapp, .recommend-container, .tag-list,
    .bpx-player-sending-area, #bilibili-player-placeholder-bottom,
    .fixed-sidenav-storage, .video-tag-container, .desc-info-text,
    .ad-report, #app footer {
      display: none !important;
    }
    body, html { overflow: hidden !important; background: #000 !important; }
    #app, #app main, .left-container, #mirror-vdcon, .video-container-v1 {
      width: 100vw !important; max-width: none !important; min-width: 0 !important;
      padding: 0 !important; margin: 0 !important;
      background: #000 !important;
    }
    /* Do NOT touch the player itself (no position/size forcing): the bpx
       player sizes and positions its own controls via JS from the page
       layout, and pinning it externally left the seek bar inoperable
       (measured 2026-10-11 — only the natural layout works). This CSS runs
       before DOMContentLoaded, so the player's mount-time sizing sees the
       widened container and fills it naturally. */
  `;
  const apply = () => {
    if (document.querySelector('style[data-preview-hide]')) return;
    const s = document.createElement('style');
    s.setAttribute('data-preview-hide', '1');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };
  /* Loading cover: black + spinner over the whole page until the
     web-fullscreen layout is confirmed — the page must never show its
     own chrome or the un-switched player (user decision 2026-10-11:
     reveal only once the switch is complete). Own style tag so the
     reveal can fade it out without touching the chrome-hiding CSS. The
     fallback timer reveals anyway when the player never reaches the
     layout, so the window cannot stick on the spinner forever. */
  const coverCss = `
    html::before {
      content: ''; position: fixed; inset: 0;
      z-index: 2147483646; background: #000;
    }
    html::after {
      content: ''; position: fixed; z-index: 2147483647;
      left: 50%; top: 50%; width: 34px; height: 34px;
      margin: -20px 0 0 -20px;
      border: 3px solid rgba(255, 255, 255, 0.22);
      border-top-color: #fff; border-radius: 50%;
      animation: pv-spin 0.8s linear infinite;
    }
    @keyframes pv-spin { to { transform: rotate(360deg); } }
  `;
  const cover = () => {
    if (document.querySelector('style[data-preview-cover]')) return;
    const s = document.createElement('style');
    s.setAttribute('data-preview-cover', '1');
    s.textContent = coverCss;
    (document.head || document.documentElement).appendChild(s);
  };
  /* Why fade instead of removing the cover outright: while content
     sits above the video, Chromium keeps it in in-tree compositing;
     removing the occluder promotes it to the DirectComposition
     overlay path, and that promotion's first presents can carry the
     pre-layout quad — the same top-left expansion the frame gate
     below hides for playback start (user report 2026-10-12: the gate
     alone did not remove it). Fading keeps a semi-transparent layer
     above the video until its quads have settled, then drops both
     tags. */
  /* Why: the flag makes the fade one-shot — run() re-invokes uncover()
     on every observer tick once __previewRevealed is set, and the
     rVFC/pointerdown/fallback paths can race each other; without it
     each call would stack another fade tag + removal timer. */
  let uncovering = false;
  const uncover = () => {
    if (uncovering) return;
    uncovering = true;
    const fade = document.createElement('style');
    fade.setAttribute('data-preview-fade', '1');
    fade.textContent = `
      html::before, html::after {
        transition: opacity 250ms linear !important;
        opacity: 0 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(fade);
    /* Note: the teardown timer (300ms) must outlast the 250ms opacity
       transition above — that ~50ms slack is what guarantees the tags
       are dropped only after the fade has fully run. */
    window.setTimeout(() => {
      document.querySelector('style[data-preview-cover]')?.remove();
      fade.remove();
    }, 300);
  };
  const startedAt = Date.now();
  const REVEAL_FALLBACK_MS = 25000;
  /* The overlay webview creation makes bilibili's player enter its mini
     mode at load (measured 2026-10-11: data-screen="mini", 320x180 at
     the bottom-right, seek bar unusable) — the player's own close
     control restores the normal in-page player, which is the layout the
     user picked as the default. Clicking the native control (rather
     than rewriting data-screen) keeps the player's internal state
     machine consistent. */
  const unmini = () => {
    const mini = document.querySelector('.bpx-player-container[data-screen="mini"]');
    const close = mini && mini.querySelector('.bpx-player-mini-close');
    if (close) close.click();
  };
  /* Enter bilibili's own web-fullscreen ("网页全屏") so the player fills
     the whole preview area — user decision 2026-10-11: the natural
     layout left the player at its in-page 668px width with black around
     it. Their native mode is used (not CSS forcing) because the player
     computes its own control geometry; the external pinning that filled
     the area before left the seek bar inoperable.
     Re-applied on every return to the in-page layout: fullscreen/PiP
     round-trips and the wide mode land back in 'normal', and the
     preview window has no page content to show there — 'normal' always
     means black bars (user decision 2026-10-11). The cooldown keeps the
     observer's rapid re-runs from double-toggling the button. */
  let lastTheaterClick = 0;
  const enterTheater = () => {
    const btn = document.querySelector('.bpx-player-ctrl-web');
    const state = document.querySelector('.bpx-player-container')?.getAttribute('data-screen');
    const now = Date.now();
    if (btn && (state === 'normal' || state === 'wide') && now - lastTheaterClick > 700) {
      lastTheaterClick = now;
      btn.click();
    }
  };
  /* Frame gate: WebView2's compositor can present the first decoded
     video frame at its pre-layout size anchored at the element's
     top-left for a frame or two before the layout quad applies — seen
     as the video briefly expanding from the preview area's top-left
     right after playback starts (user report 2026-10-12, Windows only;
     macOS WKWebView does not show it). Holding the cover until
     requestVideoFrameCallback reports a presented frame, plus one more
     rAF for the mis-composited frames to land behind the cover, hides
     the artifact. Arms only in web mode; re-arms if bpx swaps the
     <video> element (isConnected guard). Engines without rVFC degrade
     to the old immediate reveal.
     A presented frame alone is NOT sufficient (user report 2026-10-12,
     second round), and no DOM-side condition can repair it: frame
     capture that day showed the cover lifting onto a video painted as a
     small quad in the preview area's top-left for ~1s while the DOM was
     already at its final size — the player's control bar spanned the
     full area and the <video> rect matched the player container, so
     rect-stability, a settle delay and a container-width ratio were all
     satisfied (each was tried and reverted, the ratio even pinned the
     cover up entirely), and forcing the video onto its own composited
     layer (transform: translateZ(0)) changed nothing either. Raising
     the gate further only delays a reveal that stays wrong, so it is
     left as-is; the residual artifact is a WebView2 compositing issue
     (Windows-only) that the fade below reduces but does not remove.
     pointerdown reveals as well: with autoplay blocked the player's
     big play button sits under the cover — a blind click must not wait
     out the 25s fallback. The handler uncovers directly (like the
     rVFC path): run() re-runs only on DOM mutations, and a click
     swallowed by the cover on a paused player may never produce one. */
  const reveal = () => {
    window.__previewRevealed = true;
    uncover();
  };
  let gatedVideo = null;
  const armFrameGate = () => {
    if (window.__previewRevealed) return;
    if (gatedVideo && gatedVideo.isConnected) return;
    const v = document.querySelector('video');
    if (!v) return;
    gatedVideo = v;
    if (typeof v.requestVideoFrameCallback !== 'function') {
      reveal();
      return;
    }
    v.requestVideoFrameCallback(() => requestAnimationFrame(reveal));
  };
  document.addEventListener('pointerdown', reveal, { capture: true, once: true });
  const run = () => {
    apply();
    const state = document.querySelector('.bpx-player-container')?.getAttribute('data-screen');
    if (state === 'web') armFrameGate();
    if (Date.now() - startedAt > REVEAL_FALLBACK_MS) {
      window.__previewRevealed = true;
    }
    if (window.__previewRevealed) uncover();
    else cover();
    unmini();
    enterTheater();
  };
  /* Document-start safety: the initialization script runs before the
     parser has produced <html>, so poll a few ms until the root
     element exists, then install + observe. */
  const arm = () => {
    if (!document.documentElement) {
      setTimeout(arm, 4);
      return;
    }
    run();
    /* Why a real timer next to run()'s own fallback check: run() is
       driven by DOM mutations, so a page that stops mutating after the
       gate armed (autoplay blocked, player paused) would never reach
       that check and the cover would stay up forever. reveal() is
       idempotent (uncovering is one-shot). */
    setTimeout(reveal, REVEAL_FALLBACK_MS);
    document.addEventListener('DOMContentLoaded', () => run());
    new MutationObserver(() => run()).observe(document.documentElement, {
      childList: true, subtree: true,
    });
  };
  arm();
})();"#;

/// Evaluated in the overlay webview to stop playback without closing
/// the webview: Bilibili's player drives HTML5 media elements (DASH
/// plays video and audio as separate elements), so pausing every
/// element halts both tracks. The player UI follows the elements'
/// own `pause` events.
const PAUSE_PLAYBACK: &str =
    r#"document.querySelectorAll('video,audio').forEach((e) => e.pause())"#;

/// Beacons the init script sends via `window.chrome.webview.postMessage`
/// when Esc is pressed in the player page (see HIDE_VIDEO_PAGE_CHROME).
#[cfg(windows)]
const ESC_BEACON: &str = "preview:esc";

/// Windows: relays Esc pressed inside the player page to the app as the
/// `preview:esc` tauri event (consumed by VideoPreviewDialog).
///
/// Why host messaging: the player page is a remote origin and can never
/// call the tauri IPC, but WebView2's postMessage/WebMessageReceived pair
/// is available to every page in the webview (same COM access pattern as
/// inject_pairs_win). Attached once, in open_preview_player's creation
/// arm — the only place the webview comes into existence (it is reused,
/// never recreated, for later previews), so per-open attachment would
/// stack duplicate handlers. Never unregistered — the webview outlives
/// every preview.
#[cfg(windows)]
fn hook_esc_relay(webview: &tauri::Webview, app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let app = app.clone();
    webview
        .with_webview(move |pw| {
            use webview2_com::WebMessageReceivedEventHandler;
            use windows_core::PWSTR;

            let controller = pw.controller();
            let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
                return;
            };
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = PWSTR::null();
                // RAII: frees the COM-allocated string on drop.
                let message = webview2_com::CoTaskMemPWSTR::from(unsafe {
                    args.TryGetWebMessageAsString(&mut raw)?;
                    raw
                });
                if message.to_string() == ESC_BEACON {
                    let _ = app.emit(ESC_BEACON, ());
                }
                Ok(())
            }));
            // Token unused: the handler is never removed (the webview
            // outlives every preview).
            let _ = unsafe { core.add_WebMessageReceived(&handler, std::ptr::null_mut()) };
        })
        .map_err(|e| e.to_string())
}

/// Whether the overlay may show this video at all.
///
/// Why a pre-check: Bilibili answers HTTP 200 for the page of a bvid it
/// refuses (deleted / private / region-restricted) and renders the 404
/// client-side, so the page URL carries no signal (measured 2026-10-12).
/// The overlay would sit on its loading cover and then reveal whatever
/// Bilibili falls back to — reported 2026-10-12: spins, then the top
/// page. The view API is the only way to know before showing anything.
///
/// Fail-open: only a definitive `-404` (`ERR::VIDEO_NOT_FOUND`) blocks
/// the preview. A transient failure (network, risk control, minted
/// voucher, `ERR::API_ERROR`) must never turn into "preview is broken" —
/// the page itself may still play.
///
/// Takes the api rather than the AppHandle so wiremock tests can point
/// it at a local server (same seam as `fetch_wbi_view`).
async fn ensure_preview_available(api: &BiliApi, bvid: &str) -> Result<(), String> {
    match fetch_wbi_view(api, bvid).await {
        Ok(_) => Ok(()),
        Err(e) if e == "ERR::VIDEO_NOT_FOUND" => Err(e),
        Err(e) => {
            log::warn!(
                "[BE] ensure_preview_available: check for bvid={bvid} failed ({e}); opening the preview anyway"
            );
            Ok(())
        }
    }
}

/// Opens (or retargets) the official-player overlay webview over the
/// dialog's placeholder rect.
#[tauri::command]
// Why async: webview creation must run on the main thread's event loop
// (add_child marshals there internally) — a synchronous command would
// occupy the main thread and deadlock the creation (same constraint
// documented on finish_splash in window.rs).
// Why coverage(off): creates and drives a real webview on the event
// loop — injection cost outweighs value (issue #646 policy 4).
#[cfg_attr(coverage, coverage(off))]
pub async fn open_preview_player(
    app: tauri::AppHandle,
    bvid: String,
    // Multi-part page (1-indexed); None/<=1 plays the first page.
    page: Option<i32>,
    rect: OverlayRectDto,
) -> Result<(), String> {
    // bvid validation first: a malformed id needs no network round trip.
    let url = video_page_url(&bvid, page)?;
    // Gate before any webview work: a refused video must not open at all
    // (see ensure_preview_available). Cookies are optional here — the
    // WBI-signed view API accepts anonymous requests, which is also the
    // player's own logged-out state. Page-agnostic on purpose: the view
    // API answers -404 for the video, not for a part of it.
    let cookies = read_cookie(&app).ok().flatten().unwrap_or_default();
    match BiliApi::from_cookies(&cookies) {
        Ok(api) => ensure_preview_available(&api, &bvid).await?,
        // Fail-open: an unbuildable client cannot prove the video is gone.
        Err(e) => {
            log::warn!("[BE] open_preview_player: availability check skipped for bvid={bvid} ({e})")
        }
    }
    // Cookies next: the child starts loading as soon as it is built.
    inject_session_cookies(&app)?;
    let main = app
        .get_window("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    let rect = to_rect(rect);
    let bounds = overlay_bounds_for(&main, rect)?;
    let webview = match app.get_webview(PREVIEW_PLAYER_LABEL) {
        Some(existing) => {
            // Reuse the webview for the new video. The URL came from
            // video_page_url (validated, no quotes) so interpolation is
            // safe.
            existing
                .eval(format!("location.replace('{url}')"))
                .map_err(|e| e.to_string())?;
            // No re-injection needed: the init script re-runs at
            // document-created on the new document.
            existing
        }
        None => {
            let parsed: tauri::Url = url.parse().map_err(|e| format!("ERR::PREVIEW_URL: {e}"))?;
            // Why initialization_script: re-runs at document-created on
            // every top-level navigation, so the loading cover lands
            // before the first paint (see HIDE_VIDEO_PAGE_CHROME).
            // Why no background_color on macOS: wry maps it to
            // drawsBackground=NO, and the child WKWebView then composites
            // nothing at all — the page loads (URL advances) but the
            // overlay stays the placeholder's black (measured 2026-10-12,
            // macOS 26). The default opaque background renders fine; the
            // brief pre-document white is covered by the init script's
            // black loading cover at document-created.
            // Why background_color black on Windows: the pre-paint frame
            // matches the loading cover instead of flashing white
            // (carried over from the overlay-window version, measured
            // 2026-10-11).
            // Why focused(false): the WebView2 controller otherwise
            // issues a programmatic MoveFocus at creation and steals
            // keyboard focus from the main webview (wry default; same
            // workaround the overlay-window version needed, measured
            // 2026-10-11). Creation passes the final bounds, so no
            // invisible-first + reveal dance is needed.
            #[allow(unused_mut)]
            let mut builder = tauri::webview::WebviewBuilder::new(
                PREVIEW_PLAYER_LABEL,
                tauri::WebviewUrl::External(parsed),
            )
            .initialization_script(HIDE_VIDEO_PAGE_CHROME)
            .focused(false);
            #[cfg(windows)]
            {
                builder = builder.background_color(tauri::webview::Color(0, 0, 0, 255));
            }
            let webview = main
                .add_child(builder, bounds.position, bounds.size)
                .map_err(|e| e.to_string())?;
            // Esc relay (Windows): attach at the only place the webview
            // is created — every later open reuses it, so this is once
            // per webview (see hook_esc_relay for why re-attaching
            // would be wrong).
            #[cfg(windows)]
            hook_esc_relay(&webview, &app)?;
            webview
        }
    };
    // Re-apply so a retarget onto a moved dialog re-glues; on first
    // creation this is a no-op (the bounds were the creation bounds).
    webview.set_bounds(bounds).map_err(|e| e.to_string())?;
    // Re-show for the reuse path: close_preview_player hides the overlay
    // instead of destroying it (see there why). No-op on first creation.
    webview.show().map_err(|e| e.to_string())?;
    // Hand keyboard focus to the player up front: the Bilibili page runs
    // its own key handlers (space/arrows/m/f…), so focusing the overlay
    // on open makes the player keyboard-operable without a click first.
    // Both arms land here, so a retarget re-focuses as well. Deliberate
    // and ordered, unlike the creation-time MoveFocus that focused(false)
    // above suppresses (it raced the dialog's own focus management).
    // Trade-off: while the player holds focus, Tab acts in the player
    // page; Esc is relayed back on Windows (see hook_esc_relay).
    webview.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Re-positions the overlay for a new placeholder rect (dialog/layout
/// changes measured by the webview). Window moves need no sync: the
/// webview's bounds are window-relative.
#[tauri::command]
pub async fn sync_preview_player(
    app: tauri::AppHandle,
    rect: OverlayRectDto,
) -> Result<(), String> {
    let main = app
        .get_window("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    // Nothing open (a stale resize after close) — fail-soft, matching
    // pause's stale-click arm.
    let Some(webview) = app.get_webview(PREVIEW_PLAYER_LABEL) else {
        return Ok(());
    };
    webview
        .set_bounds(overlay_bounds_for(&main, to_rect(rect))?)
        .map_err(|e| e.to_string())
}

/// Pauses playback in the overlay without closing it ("open in
/// browser" keeps the preview dialog up; pausing avoids double audio).
#[tauri::command]
pub async fn pause_preview_player(app: tauri::AppHandle) -> Result<(), String> {
    // Nothing open (e.g. a stale click after close) — fail-soft.
    let Some(webview) = app.get_webview(PREVIEW_PLAYER_LABEL) else {
        return Ok(());
    };
    webview.eval(PAUSE_PLAYBACK).map_err(|e| e.to_string())
}

/// Closes the overlay (dialog closed / entry switched).
///
/// Why hide + navigate instead of `close()`: on macOS a dropped webview
/// does not go away — AppKit retains subviews, so the WKWebView stays in
/// the parent view (window-close path: measured 2026-10-12 with weak
/// refs, #831; the in-window webview has the same retention via the
/// parent NSView) while tauri's manager forgets it. The page would keep
/// running its JS and audio in the background, and the next open would
/// stack a second webview over the dead one. Instead this takes the
/// webview off screen immediately, pauses the media (instant silence),
/// and navigates to about:blank, which destroys the document — the only
/// reliable kill for the page's scripts and player. The hidden webview
/// is intentionally kept and reused by the next open (the retarget arm
/// in open_preview_player), so repeated previews leak nothing.
#[tauri::command]
pub async fn close_preview_player(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(PREVIEW_PLAYER_LABEL) {
        // Instant UX: the overlay disappears from screen first.
        let _ = webview.hide();
        // Audio stops now; the blank navigation that follows kills the
        // document itself (a pause alone would let the player auto-resume).
        // It commits in the background — nothing closes the webview, so the
        // navigation cannot be raced by teardown.
        let _ = webview.eval(PAUSE_PLAYBACK);
        let _ = webview.eval("location.replace('about:blank')");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_page_url_builds_official_url() {
        let url = video_page_url("BV1rZhC63Ek6", None).unwrap();
        assert_eq!(url, "https://www.bilibili.com/video/BV1rZhC63Ek6");
    }

    #[test]
    fn video_page_url_appends_page_query_only_past_first_page() {
        assert_eq!(
            video_page_url("BV1rZhC63Ek6", Some(3)).unwrap(),
            "https://www.bilibili.com/video/BV1rZhC63Ek6?p=3"
        );
        // First page and invalid pages carry no query (buildVideoUrl parity).
        for page in [None, Some(1), Some(0), Some(-2)] {
            assert_eq!(
                video_page_url("BV1rZhC63Ek6", page).unwrap(),
                "https://www.bilibili.com/video/BV1rZhC63Ek6"
            );
        }
    }

    #[test]
    fn video_page_url_rejects_malformed_bvids() {
        assert!(video_page_url("https://evil.example/", None).is_err());
        assert!(video_page_url("bv1rzhc63ek6", None).is_err()); // not BV-prefixed
        assert!(video_page_url("BV1rZhC63Ek", None).is_err()); // 11 chars
        assert!(video_page_url("BV1rZhC63Ek6'alert(1)", None).is_err());
    }

    #[test]
    fn overlay_bounds_maps_css_rect_unchanged_without_inset() {
        // Windows/Linux: webview origin == CSS viewport origin.
        let b = overlay_bounds(
            OverlayRect {
                x: 48.0,
                y: 120.0,
                width: 800.0,
                height: 450.0,
            },
            0.0,
        );
        assert_eq!(
            b.position,
            tauri::Position::Logical(tauri::LogicalPosition::new(48.0, 120.0))
        );
        assert_eq!(
            b.size,
            tauri::Size::Logical(tauri::LogicalSize::new(800.0, 450.0))
        );
    }

    #[test]
    fn overlay_bounds_shifts_y_by_titlebar_inset_only() {
        // macOS: CSS (0,0) sits the title-bar inset below the window's
        // content-view top. x must stay untouched and fractional logical
        // values must survive — the webview is positioned in the same
        // logical space as the CSS rect, so no physical rounding exists.
        let b = overlay_bounds(
            OverlayRect {
                x: 741.7,
                y: 376.1,
                width: 1077.0,
                height: 605.0,
            },
            28.0,
        );
        assert_eq!(
            b.position,
            tauri::Position::Logical(tauri::LogicalPosition::new(741.7, 404.1))
        );
        assert_eq!(
            b.size,
            tauri::Size::Logical(tauri::LogicalSize::new(1077.0, 605.0))
        );
    }

    #[test]
    fn bilibili_cookie_pairs_filters_to_bilibili_domain() {
        use crate::models::cookie::CookieEntry;
        let entry = |host: &str, name: &str| CookieEntry {
            host: host.to_string(),
            name: name.to_string(),
            value: format!("v-{name}"),
        };
        let pairs = bilibili_cookie_pairs(&[
            entry(".bilibili.com", "SESSDATA"),
            entry("bilibili.com", "bili_jct"),
            entry(".example.com", "other"),
        ]);
        assert_eq!(
            pairs,
            vec![
                ("SESSDATA".to_string(), "v-SESSDATA".to_string()),
                ("bili_jct".to_string(), "v-bili_jct".to_string()),
            ]
        );
    }

    #[test]
    fn overlay_rect_dto_deserializes_webview_payload() {
        let dto: OverlayRectDto =
            serde_json::from_str(r#"{"x":10.5,"y":20.0,"width":800.0,"height":450.0}"#).unwrap();
        assert_eq!(dto.x, 10.5);
        assert_eq!(dto.width, 800.0);
    }

    #[test]
    fn bilibili_cookie_pairs_matches_case_blindly_but_not_subdomains() {
        use crate::models::cookie::CookieEntry;
        let entry = |host: &str, name: &str| CookieEntry {
            host: host.to_string(),
            name: name.to_string(),
            value: format!("v-{name}"),
        };
        // Firefox imports may uppercase the host; the match stays
        // case-blind so the session still mirrors.
        let pairs = bilibili_cookie_pairs(&[entry(".BILIBILI.COM", "SESSDATA")]);
        assert_eq!(
            pairs,
            vec![("SESSDATA".to_string(), "v-SESSDATA".to_string())]
        );

        // Subdomains and look-alike suffixes never match: their cookies
        // are out of scope for the bilibili.com pages we open, and a
        // suffix match would leak them into the injection set.
        assert!(bilibili_cookie_pairs(&[
            entry("www.bilibili.com", "a"),
            entry("bilibili.com.evil.example", "b"),
            entry("evilbilibili.com", "c"),
        ])
        .is_empty());
    }

    #[test]
    fn main_webview_lookup_survives_sibling_overlay_webview() {
        // Regression (measured 2026-10-12, tauri 2.11.1): after the first
        // preview, the kept preview-player child webview stays attached to
        // the main window, and get_webview_window("main") — which requires
        // every webview on the window to share the window's label —
        // returns None from then on, failing every later open with
        // ERR::PREVIEW_NO_MAIN_WINDOW. The webview-registry lookup
        // inject_session_cookies uses must keep resolving in that state.
        let app = tauri::test::mock_app();
        let handle = app.handle();
        tauri::WebviewWindowBuilder::new(handle, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        // Reproduce the post-preview state: a sibling child webview on
        // main, kept for reuse by close_preview_player.
        handle
            .get_window("main")
            .unwrap()
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    PREVIEW_PLAYER_LABEL,
                    tauri::WebviewUrl::default(),
                ),
                tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)),
                tauri::Size::Logical(tauri::LogicalSize::new(10.0, 10.0)),
            )
            .unwrap();
        // Documents the tauri quirk the production code works around; if
        // this ever turns Some, get_webview_window becomes usable again.
        assert!(handle.get_webview_window("main").is_none());
        // The lookup used by inject_session_cookies.
        assert_eq!(handle.get_webview("main").unwrap().label(), "main");
    }

    // ---- availability gate (wiremock) ----

    /// Mounts the `/x/web-interface/nav` hop every WBI call starts with.
    async fn mount_nav(server: &wiremock::MockServer) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/nav"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "code": 0, "message": "0", "ttl": 1,
                    "data": { "isLogin": false, "mid": 0, "uname": "",
                              "wbi_img": { "img_url": "i", "sub_url": "s" } }
                })),
            )
            .mount(server)
            .await;
    }

    /// Mounts the view response the gate reads.
    async fn mount_view(server: &wiremock::MockServer, body: serde_json::Value) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/web-interface/wbi/view"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    /// Gate api over `server`, logged out (empty Cookie header): the
    /// check must work for anonymous sessions too — that is also the
    /// state the preview degrades to.
    fn gate_api(server: &wiremock::MockServer) -> BiliApi {
        BiliApi::new(reqwest::Client::new(), server.uri(), "")
    }

    #[tokio::test]
    async fn availability_gate_blocks_refused_video() {
        let server = wiremock::MockServer::start().await;
        mount_nav(&server).await;
        // -404 is what Bilibili answers for deleted / private /
        // region-blocked videos (`validate_api_response`).
        mount_view(
            &server,
            serde_json::json!({ "code": -404, "message": "啥都木有" }),
        )
        .await;

        let err = ensure_preview_available(&gate_api(&server), "BV1deleted0")
            .await
            .unwrap_err();
        assert_eq!(err, "ERR::VIDEO_NOT_FOUND");
    }

    #[tokio::test]
    async fn availability_gate_allows_playable_video() {
        let server = wiremock::MockServer::start().await;
        mount_nav(&server).await;
        mount_view(
            &server,
            serde_json::json!({
                "code": 0, "message": "0",
                "data": { "title": "playable", "pic": "p", "cid": 1, "pages": [] }
            }),
        )
        .await;

        assert!(ensure_preview_available(&gate_api(&server), "BV1playable0")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn availability_gate_fails_open_on_other_api_errors() {
        let server = wiremock::MockServer::start().await;
        mount_nav(&server).await;
        // Risk control / minted voucher answers are not proof the video is
        // gone: blocking the preview on them would break a preview the
        // page itself can still play.
        mount_view(
            &server,
            serde_json::json!({ "code": -412, "message": "request was intercepted" }),
        )
        .await;

        assert!(ensure_preview_available(&gate_api(&server), "BV1riskctl00")
            .await
            .is_ok());
    }
}
