//! Official-page preview: plays search-result previews through
//! Bilibili's real video page (`www.bilibili.com/video/…`) in a
//! frame-less child window overlaid on the preview dialog's video area.
//!
//! Why a child window and not an in-page iframe: the WebView2 runtime
//! blocks third-party frames from touching cookies at the engine level
//! (measured 2026-10-11 — `document.cookie` stays empty and the page's
//! APIs answer logged-out even with Edge tracking prevention disabled),
//! so an embedded iframe can never authenticate. As a top-level window
//! the page is first-party: the stored session cookies log it in.
//!
//! Why the video page and not the official embed player
//! (`player.bilibili.com/player.html`): the embed's quality menu does
//! not switch (clicks land but no playurl request is issued, `qn` URL
//! params are ignored) and after that interaction its click handlers
//! stick (center-click play/pause goes dead until reload) — measured
//! 2026-10-11 with input delivery verified correct at every layer. The
//! full page has none of these quirks.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Mutex,
};

use tauri::Manager;

/// Official video page URL for one search result. The bvid is validated
/// because it is interpolated into a URL — search entries are ours, but
/// the trust boundary is here.
pub fn video_page_url(bvid: &str) -> Result<String, String> {
    let body_ok = bvid.len() == 12
        && bvid.starts_with("BV")
        && bvid[2..].bytes().all(|b| b.is_ascii_alphanumeric());
    if !body_ok {
        return Err(format!("ERR::INVALID_BVID: {bvid}"));
    }
    Ok(format!("https://www.bilibili.com/video/{bvid}"))
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

/// Physical top-left + size for the overlay window: the viewport origin
/// (client-area origin of the main window) plus the scaled logical rect.
/// The scale factor is read on every apply so monitor moves re-derive it.
pub fn overlay_target(
    viewport_origin: tauri::PhysicalPosition<i32>,
    scale: f64,
    rect: OverlayRect,
) -> (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    (
        tauri::PhysicalPosition::new(
            viewport_origin.x + (rect.x * scale).round() as i32,
            viewport_origin.y + (rect.y * scale).round() as i32,
        ),
        tauri::PhysicalSize::new(
            (rect.width * scale).round() as u32,
            (rect.height * scale).round() as u32,
        ),
    )
}

/// One-pass frame correction: Windows decorates even a `decorations(false)`
/// child window with an invisible frame, so the CLIENT origin lands a few
/// px off the outer position (measured ≈8px/1px at 1.5 DPI, 2026-10-11).
/// Shift the outer position by the observed client-vs-desired delta.
pub fn corrected_outer_position(
    desired: tauri::PhysicalPosition<i32>,
    current_client: tauri::PhysicalPosition<i32>,
    current_outer: tauri::PhysicalPosition<i32>,
) -> tauri::PhysicalPosition<i32> {
    tauri::PhysicalPosition::new(
        current_outer.x + (desired.x - current_client.x),
        current_outer.y + (desired.y - current_client.y),
    )
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
/// the first-party player window authenticates as the logged-in user.
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
    let main = app
        .get_webview_window("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    let webview: &tauri::Webview = main.as_ref();
    #[cfg(windows)]
    inject_pairs_win(webview, &pairs)?;
    #[cfg(not(windows))]
    inject_pairs_portable(webview, &pairs)?;
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

struct OverlayState {
    rect: OverlayRect,
}

static OVERLAY: LazyLock<Mutex<Option<OverlayState>>> = LazyLock::new(|| Mutex::new(None));

/// Whether the main-window follow hook is attached. `on_window_event`
/// has no unsubscribe and the main window lives for the whole process,
/// so every overlay reopen would stack another Moved/Resized listener
/// that re-runs apply_rect on each drag event.
static MAIN_HOOK_ATTACHED: AtomicBool = AtomicBool::new(false);

fn lock_overlay() -> std::sync::MutexGuard<'static, Option<OverlayState>> {
    OVERLAY.lock().unwrap_or_else(|p| p.into_inner())
}

fn to_rect(dto: OverlayRectDto) -> OverlayRect {
    OverlayRect {
        x: dto.x,
        y: dto.y,
        width: dto.width,
        height: dto.height,
    }
}

/// Sizes + positions the child over the given rect. Reads scale/origin
/// on every call so monitor moves and main-window moves re-derive them.
fn apply_rect(
    main: &tauri::WebviewWindow,
    child: &tauri::WebviewWindow,
    rect: OverlayRect,
) -> Result<(), String> {
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = viewport_origin(main, scale)?;
    let (pos, size) = overlay_target(origin, scale, rect);
    child
        .set_size(tauri::Size::Physical(size))
        .map_err(|e| e.to_string())?;
    child
        .set_position(tauri::Position::Physical(pos))
        .map_err(|e| e.to_string())?;
    // Windows-only one-pass frame correction: Windows decorates even a
    // `decorations(false)` child with an invisible frame (see
    // corrected_outer_position). On macOS the borderless child has
    // client == outer, and child.inner_position() lags one set_position
    // behind (WKWebView async layout — measured 2026-10-11), so the
    // correction there oscillated between two wrong positions instead of
    // converging.
    #[cfg(windows)]
    {
        let client = child.inner_position().map_err(|e| e.to_string())?;
        let outer = child.outer_position().map_err(|e| e.to_string())?;
        let fixed = corrected_outer_position(pos, client, outer);
        child
            .set_position(tauri::Position::Physical(fixed))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Screen-space origin (physical px) of the main webview's CSS viewport.
///
/// `inner_position()` is NOT the viewport origin on macOS: the main
/// window uses a full-size content view, so the content rect starts at
/// the frame origin while the WKWebView's layout viewport is pushed
/// below the title bar (measured 2026-10-11: inner == outer ==
/// (0, 62) physical, but CSS (0,0) sits at (0, 126)). Derive the
/// title-bar inset from NSWindow.contentLayoutRect and add it to the
/// frame origin; this also tracks fullscreen (inset 0) for free. On
/// Windows/Linux `inner_position()` already is the client-area origin.
fn viewport_origin(
    main: &tauri::WebviewWindow,
    scale: f64,
) -> Result<tauri::PhysicalPosition<i32>, String> {
    #[cfg(target_os = "macos")]
    {
        let outer = main.outer_position().map_err(|e| e.to_string())?;
        let inset = titlebar_inset_physical(main, scale)?;
        Ok(tauri::PhysicalPosition::new(outer.x, outer.y + inset))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = scale;
        main.inner_position().map_err(|e| e.to_string())
    }
}

/// Title-bar height of the main window in physical px: NSWindow frame
/// height minus contentLayoutRect height. Runs on the main thread —
/// AppKit getters must not be called from worker threads (apply_rect is
/// reached from async commands and the window-event hook alike).
#[cfg(target_os = "macos")]
fn titlebar_inset_physical(main: &tauri::WebviewWindow, scale: f64) -> Result<i32, String> {
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
    // services the closure — the deadlock the attach_hooks spawn
    // guards against. The cap degrades that case to an Err instead.
    rx.recv_timeout(std::time::Duration::from_secs(1))
        .map_err(|e| e.to_string())
}

/// Applies the chrome-hiding style in the overlay page. The evals are
/// fired as a burst over the first seconds of a load: an eval racing an
/// in-flight navigation can land on the outgoing document (a no-op),
/// and the script must land before the page's first paint so the
/// loading cover hides the page while the player boots (user decision
/// 2026-10-11 — the half-loaded page used to be visible for seconds).
/// The script itself is idempotent and hooks DOMContentLoaded when the
/// new document is still loading.
fn schedule_chrome_hider(child: &tauri::WebviewWindow) {
    for delay_ms in [0u64, 150, 300, 500, 750, 1100, 1600, 2400, 3400] {
        let child = child.clone();
        tauri::async_runtime::spawn(async move {
            if delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            let _ = child.eval(HIDE_VIDEO_PAGE_CHROME);
        });
    }
}

fn attach_hooks(app: &tauri::AppHandle, main: &tauri::WebviewWindow, child: &tauri::WebviewWindow) {
    use tauri::Emitter;
    // Direct close (Alt+F4): clear state and tell the dialog to close.
    let app_for_destroy = app.clone();
    child.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            lock_overlay().take();
            let _ = app_for_destroy.emit("preview-player-closed", ());
        }
    });
    // Owned windows do NOT follow their owner on Windows (measured
    // 2026-10-11): follow manually on main-window moves/resizes. This
    // fires often during drags — if live verification shows jitter,
    // throttle here (e.g. 30ms) before touching callers.
    if MAIN_HOOK_ATTACHED.swap(true, Ordering::SeqCst) {
        return; // Already attached by a previous overlay.
    }
    let app_for_sync = app.clone();
    main.on_window_event(move |event| {
        if !matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
        ) {
            return;
        }
        let Some(rect) = lock_overlay().as_ref().map(|s| s.rect) else {
            return;
        };
        let (Some(main), Some(child)) = (
            app_for_sync.get_webview_window("main"),
            app_for_sync.get_webview_window(PREVIEW_PLAYER_LABEL),
        ) else {
            return;
        };
        // Why spawn: this hook runs on the main-thread event loop, while
        // apply_rect's macOS title-bar read marshals back to the main
        // thread — calling it synchronously would deadlock.
        tauri::async_runtime::spawn(async move {
            let _ = apply_rect(&main, &child, rect);
        });
    });
}

/// Window label of the overlay (single instance; retargeted per video).
const PREVIEW_PLAYER_LABEL: &str = "preview-player";

/// Evaluated in the overlay webview after (re)navigation: strips the
/// video page chrome so the overlay shows the player only, full-bleed.
///
/// Why eval and not the builder's `initialization_script`: that hook
/// never fired for this webview's external pages (measured 2026-10-11 —
/// marker scripts absent on every load), while a post-navigation eval
/// applies reliably. The script is idempotent and self-schedules on
/// DOMContentLoaded for in-flight navigations; the MutationObserver
/// re-applies after bilibili's SPA hydration churns the DOM. The player
/// is never restyled — its own mini-mode close control and its own
/// web-fullscreen toggle get clicked instead. A page-level loading
/// cover (black + spinner) hides everything until that switch has
/// happened.
///
/// Why hide page chrome instead of a player-only URL: the official
/// embed player and the blackboard html5player both render a broken
/// quality menu (items gated/no switch — measured 2026-10-11), while
/// the real video page's player is fully functional. Selectors are
/// bilibili's page classes — a redesign degrades to showing the page
/// again, never to a broken player.
const HIDE_VIDEO_PAGE_CHROME: &str = r#"(() => {
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
     reveal removes it without touching the chrome-hiding CSS. The
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
  const uncover = () => {
    document.querySelector('style[data-preview-cover]')?.remove();
  };
  const startedAt = Date.now();
  const REVEAL_FALLBACK_MS = 25000;
  /* The overlay window creation makes bilibili's player enter its mini
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
  const run = () => {
    apply();
    const state = document.querySelector('.bpx-player-container')?.getAttribute('data-screen');
    if (state === 'web' || Date.now() - startedAt > REVEAL_FALLBACK_MS) {
      window.__previewRevealed = true;
    }
    if (window.__previewRevealed) uncover();
    else cover();
    unmini();
    enterTheater();
  };
  run();
  document.addEventListener('DOMContentLoaded', () => run());
  new MutationObserver(() => run()).observe(document.documentElement, {
    childList: true, subtree: true,
  });
})();"#;

/// Evaluated in the overlay webview to stop playback without closing
/// the window: Bilibili's player drives HTML5 media elements (DASH
/// plays video and audio as separate elements), so pausing every
/// element halts both tracks. The player UI follows the elements'
/// own `pause` events.
const PAUSE_PLAYBACK: &str =
    r#"document.querySelectorAll('video,audio').forEach((e) => e.pause())"#;

/// Opens (or retargets) the official-player overlay window over the
/// dialog's placeholder rect.
#[tauri::command]
// Why async: WebviewWindowBuilder::build() must run on the main thread's event
// loop — a synchronous command would occupy the main thread and deadlock the
// window creation (same constraint documented on finish_splash in window.rs).
// Why coverage(off): creates and drives a real OS overlay window on the
// event loop — injection cost outweighs value (issue #646 policy 4).
#[cfg_attr(coverage, coverage(off))]
pub async fn open_preview_player(
    app: tauri::AppHandle,
    bvid: String,
    rect: OverlayRectDto,
) -> Result<(), String> {
    // Cookies first: the child starts loading as soon as it is built.
    inject_session_cookies(&app)?;
    let url = video_page_url(&bvid)?;
    let main = app
        .get_webview_window("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    let child = match app.get_webview_window(PREVIEW_PLAYER_LABEL) {
        Some(existing) => {
            // Reuse the window for the new video. The URL came from
            // video_page_url (validated, no quotes) so interpolation is
            // safe.
            existing
                .eval(format!("location.replace('{url}')"))
                .map_err(|e| e.to_string())?;
            schedule_chrome_hider(&existing);
            existing
        }
        None => {
            let parsed: tauri::Url = url.parse().map_err(|e| format!("ERR::PREVIEW_URL: {e}"))?;
            let child = tauri::WebviewWindowBuilder::new(
                &app,
                PREVIEW_PLAYER_LABEL,
                tauri::WebviewUrl::External(parsed),
            )
            .title("preview")
            .decorations(false)
            .resizable(false)
            // Why: this is an overlay glued to the dialog's black video
            // placeholder, not a user window — hidden from the taskbar/alt-tab,
            // no native shadow (it would draw a visible outline over the
            // placeholder), and a black window background so the pre-paint
            // frame matches the page's loading cover instead of flashing white.
            .skip_taskbar(true)
            .shadow(false)
            .background_color(tauri::webview::Color(0, 0, 0, 255))
            // Why not focusable/focused: the overlay must never take
            // foreground or keyboard focus — otherwise Win+Arrow (and every
            // keyboard shortcut aimed at the main window) would act on the
            // overlay instead. focusable(false) keeps mouse input (player
            // controls work) while blocking click activation
            // (WS_EX_NOACTIVATE); focused(false) stops the WebView2
            // controller from stealing focus with a programmatic MoveFocus
            // right after creation (wry default — programmatic focus
            // bypasses WS_EX_NOACTIVATE).
            // Note: parent() returns Result, so the chain turns fallible
            // there (map_err + ?); infallible setters stay above it.
            .focusable(false)
            .focused(false)
            // Why visible(false): with no builder position the OS creates
            // the window at CW_USEDEFAULT (top-left, 800×600 default) and
            // visible — a black frame flashed there until apply_rect moved
            // it (same pattern as the splash window in window.rs).
            .visible(false)
            .parent(&main)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
            attach_hooks(&app, &main, &child);
            schedule_chrome_hider(&child);
            child
        }
    };
    let rect = to_rect(rect);
    apply_rect(&main, &child, rect)?;
    // Reveal only after apply_rect pins the rect, so the overlay never
    // paints at the creation-time default location; no-op on the
    // reuse path (window already visible).
    child.show().map_err(|e| e.to_string())?;
    lock_overlay().replace(OverlayState { rect });
    Ok(())
}

/// Re-positions the overlay for a new placeholder rect (dialog/layout
/// changes measured by the webview).
#[tauri::command]
pub async fn sync_preview_player(
    app: tauri::AppHandle,
    rect: OverlayRectDto,
) -> Result<(), String> {
    if lock_overlay().is_none() {
        return Ok(()); // Nothing open (a stale resize after close).
    }
    let main = app
        .get_webview_window("main")
        .ok_or("ERR::PREVIEW_NO_MAIN_WINDOW")?;
    let child = app
        .get_webview_window(PREVIEW_PLAYER_LABEL)
        .ok_or("ERR::PREVIEW_NO_OVERLAY")?;
    let rect = to_rect(rect);
    apply_rect(&main, &child, rect)?;
    lock_overlay().replace(OverlayState { rect });
    Ok(())
}

/// Pauses playback in the overlay without closing it ("open in
/// browser" keeps the preview dialog up; pausing avoids double audio).
#[tauri::command]
pub async fn pause_preview_player(app: tauri::AppHandle) -> Result<(), String> {
    // Nothing open (e.g. a stale click after the overlay died) — the
    // overlay-gone case is fail-soft, matching sync's stale-resize arm.
    if lock_overlay().is_none() {
        return Ok(());
    }
    let Some(child) = app.get_webview_window(PREVIEW_PLAYER_LABEL) else {
        return Ok(());
    };
    child.eval(PAUSE_PLAYBACK).map_err(|e| e.to_string())
}

/// Closes the overlay (dialog closed / entry switched).
#[tauri::command]
pub async fn close_preview_player(app: tauri::AppHandle) -> Result<(), String> {
    lock_overlay().take();
    if let Some(child) = app.get_webview_window(PREVIEW_PLAYER_LABEL) {
        let _ = child.close();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_page_url_builds_official_url() {
        let url = video_page_url("BV1rZhC63Ek6").unwrap();
        assert_eq!(url, "https://www.bilibili.com/video/BV1rZhC63Ek6");
    }

    #[test]
    fn video_page_url_rejects_malformed_bvids() {
        assert!(video_page_url("https://evil.example/").is_err());
        assert!(video_page_url("bv1rzhc63ek6").is_err()); // not BV-prefixed
        assert!(video_page_url("BV1rZhC63Ek").is_err()); // 11 chars
        assert!(video_page_url("BV1rZhC63Ek6'alert(1)").is_err());
    }

    #[test]
    fn overlay_target_scales_logical_rect_to_physical() {
        let (pos, size) = overlay_target(
            tauri::PhysicalPosition::new(30, 45),
            1.5,
            OverlayRect {
                x: 100.0,
                y: 40.0,
                width: 800.0,
                height: 450.0,
            },
        );
        assert_eq!(pos, tauri::PhysicalPosition::new(180, 105)); // 30+150, 45+60
        assert_eq!(size, tauri::PhysicalSize::new(1200, 675));
    }

    #[test]
    fn overlay_target_rounds_fractional_physical_values() {
        // 1.5 DPI turns whole logical px into physical halves
        // (85.0 * 1.5 = 127.5): the overlay must land on the rounded
        // pixel, not truncate toward zero.
        let (pos, size) = overlay_target(
            tauri::PhysicalPosition::new(10, 20),
            1.5,
            OverlayRect {
                x: 85.0,
                y: 84.0,
                width: 501.0,
                height: 333.0,
            },
        );
        assert_eq!(pos, tauri::PhysicalPosition::new(138, 146)); // 10+128, 20+126
        assert_eq!(size, tauri::PhysicalSize::new(752, 500)); // 751.5, 499.5
    }

    #[test]
    fn corrected_outer_position_shifts_by_frame_delta() {
        // Client landed 8px right / 1px below the outer position
        // (measured Windows frame at 1.5 DPI): the outer position must
        // move back by exactly that.
        let fixed = corrected_outer_position(
            tauri::PhysicalPosition::new(180, 105),
            tauri::PhysicalPosition::new(188, 106),
            tauri::PhysicalPosition::new(180, 105),
        );
        assert_eq!(fixed, tauri::PhysicalPosition::new(172, 104));
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
}
