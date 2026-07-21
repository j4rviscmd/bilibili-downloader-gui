//! Window creation and geometry persistence.
//!
//! Two-window model (Discord-style splash):
//! - "splash": borderless, fixed-size, centered splash window shown on launch
//!   while initialization runs behind it. The whole window is draggable via
//!   `data-tauri-drag-region` on the frontend.
//! - "main": the application window, created after the splash finishes, with
//!   saved geometry / maximized restore.
//!
//! Why no splash-time geometry lock: the previous design locked the main
//! window with resizable(false)+maximizable(false) during the splash and
//! restored maximized via builder.maximized(true). On Windows, a maximized
//! window is only clamped to the work area (excluding the taskbar) while
//! WS_THICKFRAME (resizable) is present, so the locked+maximized restore
//! covered the taskbar until enable_window_resize flipped resizable back on.
//! Splitting the splash into its own window removes that conflict entirely —
//! the main window is built resizable and maximizes correctly from the start.

use crate::models::settings::{Settings, UiTheme};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

const DEFAULT_WIDTH: f64 = 980.0;
const DEFAULT_HEIGHT: f64 = 609.0;
const MIN_WIDTH: f64 = 980.0;
const MIN_HEIGHT: f64 = 609.0;
const WINDOW_TITLE: &str = "Bilibili Downloader";
const GEOMETRY_STORE_KEY: &str = "windowGeometry";

// Splash window dimensions (logical). Square on all platforms for a consistent
// Discord-style splash. Tunable; the frontend splash route fills this area.
const SPLASH_WIDTH: f64 = 480.0;
const SPLASH_HEIGHT: f64 = 480.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    // CONSTRAINT: `#[serde(default)]` keeps deserialization backward-compatible
    // with store entries written before this field existed (older versions only
    // persisted x/y/width/height).
    #[serde(default)]
    maximized: bool,
}

impl WindowGeometry {
    /// Fallback used when `read_raw_geometry` returns None.
    const DEFAULT: Self = Self {
        x: 0.0,
        y: 0.0,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        maximized: false,
    };
}

/// Creates the borderless, fixed-size, centered splash window.
///
/// Content is served from the frontend "/splashscreen" route. `decorations
/// (false)` removes the title bar/borders; the frontend makes the whole
/// window draggable via `data-tauri-drag-region`. Resizable/maximizable are
/// disabled because the splash has a fixed size.
///
/// `transparent(true)` makes the OS window background transparent so the
/// frontend can render rounded corners (via CSS `border-radius`): without it
/// the area outside the rounded corners would be filled by the opaque window
/// background and the rounded shape wouldn't be visible. The native window
/// shadow still follows the rounded outline via the default `shadow(true)`.
pub fn create_splash_window(
    app: &AppHandle,
    theme: Option<Theme>,
    language: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Pass the language as a query param so the splash can apply i18n before
    // first paint (labels render in the user's language).
    let url = match &language {
        Some(lang) => format!("splashscreen?lang={}", lang),
        None => "splashscreen".to_string(),
    };
    let _splash = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App(url.into()))
        .title(WINDOW_TITLE)
        .theme(theme.or(Some(Theme::Light)))
        .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .min_inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .max_inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .decorations(false)
        .transparent(true)
        .center()
        .resizable(false)
        // Why visible(false): the webview needs a frame to load the splash
        // route before first paint. The frontend invokes show_splash once
        // React has mounted, so the user never sees the blank/black loading
        // frame.
        .visible(false)
        .build()?;
    Ok(())
}

/// Shows the splash window after the frontend has mounted. Called via
/// `show_splash` from SplashScreen's first effect to avoid a black frame
/// while the webview loads the splash route.
#[tauri::command]
pub fn show_splash(app: AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splash") {
        splash.show().map_err(|e| format!("{e}"))?;
        splash.set_focus().map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

/// Creates the main application window with saved or default geometry.
///
/// Built resizable (no splash-time lock) so the OS-native maximize clamps to
/// the work area on Windows. Call this from `finish_splash` after the splash
/// window is done.
pub fn create_main_window(
    app: &AppHandle,
    theme: Option<Theme>,
) -> Result<(), Box<dyn std::error::Error>> {
    let geometry = read_saved_geometry(app);
    let should_maximize = geometry.as_ref().map(|g| g.maximized).unwrap_or(false);

    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title(WINDOW_TITLE)
        .theme(theme.or(Some(Theme::Light)))
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT);

    // Maximized restoration branches by platform because the correct approach
    // differs between Windows and macOS.
    //
    // - Windows: builder.maximized(true) produces the OS-native maximized
    //   window, which correctly handles the invisible resize border (~7
    //   physical px). Sizing to the work area instead cannot reproduce that
    //   border and yields a window that spills over the taskbar or is smaller
    //   than a true maximize.
    //
    // - macOS: CAUTION — do NOT use builder.maximized(true). tao implements
    //   maximized by creating the window at inner_size, showing it, then
    //   calling set_maximized async — which dispatches
    //   setFrame:display:animate:YES (or NSWindow zoom:). Both branches
    //   animate and cannot be suppressed through Tauri's public API, so the
    //   "normal-size -> maximized" resize is always visible, even with
    //   visible(false)+show() (show() flushes the pending animated frame
    //   change). So on macOS we instead size the window to the primary
    //   monitor's work area at construction time. No post-create resize ever
    //   happens, so there is no animation. Trade-off: this yields a
    //   "maximized-sized normal window" rather than a true isZoomed state, so
    //   un-maximizing does not restore the previous size automatically.
    if should_maximize {
        #[cfg(target_os = "windows")]
        {
            // Why: set the saved (pre-maximize normal) geometry as inner_size
            // so un-maximizing auto-restores the previous size. Build
            // invisible, then maximize, then show so the normal-size frame
            // never flashes on screen.
            if let Some(geo) = &geometry {
                builder = builder
                    .inner_size(geo.width, geo.height)
                    .position(geo.x, geo.y);
            }
            builder = builder.visible(false).maximized(true);
        }
        #[cfg(not(target_os = "windows"))]
        {
            builder = match primary_monitor_work_area_logical(app) {
                Some((w, h, x, y)) => builder.inner_size(w, h).position(x, y),
                None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT),
            };
        }
    } else {
        builder = match geometry {
            Some(geo) => builder
                .inner_size(geo.width, geo.height)
                .position(geo.x, geo.y),
            None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT),
        };
    }

    let window = builder.build()?;

    // Why: on Windows the window was built invisible (visible(false)) to avoid
    // flashing the normal-size frame before maximization is applied. Reveal it
    // once the maximized frame is in place.
    #[cfg(target_os = "windows")]
    if should_maximize {
        let _ = window.show();
    }

    window.set_focus()?;
    Ok(())
}

/// Closes the splash window and creates the main window with restored geometry.
///
/// Called from the frontend after initialization completes. The main window is
/// built resizable so the OS-native maximize clamps to the work area (no
/// taskbar occlusion during restore).
#[tauri::command]
pub async fn finish_splash(app: AppHandle) -> Result<(), String> {
    log::info!("[BE] finish_splash: called");
    let theme = read_window_theme(&app);
    // Why async: WebviewWindowBuilder::build() must run on the main thread's
    // event loop. A synchronous command occupies the main thread and deadlocks
    // the window creation. An async command runs on a worker thread, freeing
    // the main thread so build() can proceed.
    create_main_window(&app, theme).map_err(|e| {
        log::error!("[BE] finish_splash: create_main_window error: {e}");
        format!("{e}")
    })?;
    log::info!("[BE] finish_splash: main window created");
    register_main_window_events(&app);
    // Close the splash AFTER the main window is up. Closing it first can leave
    // zero windows momentarily and trigger process exit before main is shown.
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    log::info!("[BE] finish_splash: done");
    Ok(())
}

/// Registers close/resize/move handlers (and opens devtools in debug) on the
/// main window. Must run AFTER the main window is created. In normal mode this
/// is called from `finish_splash` (after the splash creates the main window);
/// in E2E mode it is called directly from `setup` because the splash window is
/// skipped.
pub(crate) fn register_main_window_events(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { .. } => {
            save_window_geometry(&app_handle);
            log::info!("[BE] Application exiting - main window closed");
        }
        // CAUTION: Cmd+Q (macOS) and programmatic exit() bypass CloseRequested,
        // so persisting here keeps the latest normal geometry available even
        // when the app exits without closing the window normally.
        // save_window_geometry internally skips fullscreen and maximized-only
        // states, so only real changes to the normal geometry land on disk.
        tauri::WindowEvent::Resized { .. } | tauri::WindowEvent::Moved { .. } => {
            save_window_geometry(&app_handle);
        }
        _ => {}
    });

    // Devtools in debug builds (respects openDevtoolsOnStartup, skipped during
    // E2E tests). Moved here from setup because the main window no longer
    // exists at setup time.
    #[cfg(debug_assertions)]
    {
        if !crate::handlers::qr_login::is_e2e_testing() {
            let settings_path = crate::utils::paths::get_settings_path(app);
            let should_open = if settings_path.exists() {
                std::fs::read_to_string(&settings_path)
                    .ok()
                    .and_then(|content| serde_json::from_str::<Settings>(&content).ok())
                    .and_then(|s| s.open_devtools_on_startup)
                    .unwrap_or(true)
            } else {
                true
            };
            if should_open {
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
        }
    }
}

/// Reads the saved UI theme (if any) to apply to windows. Shared by lib::setup
/// (splash) and finish_splash (main) so both windows match the user theme.
pub fn read_window_theme(app: &AppHandle) -> Option<Theme> {
    crate::utils::paths::get_settings_path(app)
        .exists()
        .then(|| {
            std::fs::read_to_string(crate::utils::paths::get_settings_path(app))
                .ok()
                .and_then(|content| serde_json::from_str::<Settings>(&content).ok())
                .and_then(|s| s.theme)
        })
        .flatten()
        .map(|t| match t {
            UiTheme::Dark => Theme::Dark,
            UiTheme::Light => Theme::Light,
        })
}

/// Saves the current window geometry to the store.
///
/// Called from multiple lifecycle points (window close, app exit request,
/// resize, move) so geometry survives every exit path — including Cmd+Q on
/// macOS, which bypasses `WindowEvent::CloseRequested`.
///
/// Behavior:
/// - Fullscreen windows are skipped: the window reports full-screen bounds
///   here, and since the fullscreen state itself is intentionally not
///   persisted, overwriting would restore an oversized normal window.
/// - Maximized windows persist only the `maximized` flag, reusing the last
///   saved normal geometry so un-maximizing on next launch restores the real
///   size instead of the full-screen bounds.
/// - Normal windows persist their current bounds with `maximized: false`.
pub fn save_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Skip while fullscreen: the reported bounds would corrupt the saved normal
    // geometry (fullscreen state itself is intentionally not persisted).
    let Ok(is_fullscreen) = window.is_fullscreen() else {
        return;
    };
    if is_fullscreen {
        return;
    }

    let Ok(is_maximized) = window.is_maximized() else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    // Why: maximize() can dispatch its Resized event before is_maximized()
    // flips to true. Without the size check, a maximized window would be
    // persisted with work-area-sized bounds as the "normal" geometry,
    // corrupting the real normal size (so the next launch restores an
    // oversized normal window). Treat any window covering the work area as
    // maximized regardless of is_maximized() to prevent that.
    let effective_maximized = is_maximized || is_maximize_sized(app, logical_w, logical_h);

    // NOTE: Known trade-off of "Approach A" (maximized → work-area-sized
    // normal window at launch): the construction-time sizing emits a Resized
    // event, which can overwrite the user's real normal geometry with the
    // transient work-area bounds if they resize before the next persist.
    // This data loss is accepted as the cost of avoiding the startup flash.
    let geo = if effective_maximized {
        // Persist only the flag; reuse the last normal geometry so un-maximizing
        // on next launch restores the real size instead of full-screen bounds.
        let prev = read_raw_geometry(app).unwrap_or(WindowGeometry::DEFAULT);
        WindowGeometry {
            maximized: true,
            ..prev
        }
    } else {
        let Ok(pos) = window.outer_position() else {
            return;
        };
        WindowGeometry {
            x: pos.x as f64 / scale,
            y: pos.y as f64 / scale,
            width: logical_w,
            height: logical_h,
            maximized: false,
        }
    };

    if let Ok(store) = app.store("window-state.json") {
        store.set(
            GEOMETRY_STORE_KEY,
            serde_json::to_value(&geo).unwrap_or_default(),
        );
        // Why: store.set() only schedules a debounced autosave (~100ms), but
        // Windows tears down the process as soon as the last window closes, so
        // the timer may not fire before exit. Save explicitly (mirrors
        // settings.rs) to guarantee the latest geometry reaches disk.
        let _ = store.save();
    }
}

/// Returns the primary monitor's work area in logical coordinates as
/// (width, height, x, y).
///
/// Used by the macOS/Linux pseudo-maximize restore in create_main_window and
/// by the maximize-size self-heal in read_saved_geometry.
fn primary_monitor_work_area_logical(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let rect = monitor.work_area();
    Some((
        rect.size.width as f64 / scale,
        rect.size.height as f64 / scale,
        rect.position.x as f64 / scale,
        rect.position.y as f64 / scale,
    ))
}

/// Reads the raw saved geometry without monitor validation.
///
/// Unlike `read_saved_geometry`, this performs no position/size validation and
/// is used only to preserve the last normal geometry when persisting the
/// `maximized` flag alone (maximized windows report full-screen bounds).
fn read_raw_geometry(app: &AppHandle) -> Option<WindowGeometry> {
    let store = app.store("window-state.json").ok()?;
    let raw = store.get(GEOMETRY_STORE_KEY)?;
    serde_json::from_value(raw).ok()
}

/// Reads saved window geometry from the persistent store.
///
/// Returns `Some(geometry)` only when:
/// 1. A valid store entry exists
/// 2. Both dimensions meet the minimum size requirements
/// 3. The saved position falls within an active monitor
/// 4. At least one monitor can accommodate the saved size
///
/// Returns `None` otherwise, causing the caller to fall back to defaults.
fn read_saved_geometry(app: &AppHandle) -> Option<WindowGeometry> {
    let store = app.store("window-state.json").ok()?;
    let raw = store.get(GEOMETRY_STORE_KEY)?;
    let mut geo: WindowGeometry = serde_json::from_value(raw).ok()?;

    geo.width = geo.width.max(MIN_WIDTH);
    geo.height = geo.height.max(MIN_HEIGHT);

    // Self-heal: older versions could persist work-area-sized bounds alongside
    // maximized: true (maximize()'s Resized raced ahead of is_maximized()).
    // Restoring that as a normal window would cover the taskbar / sit off-
    // screen during the splash. Since the window is re-maximized on launch
    // anyway, fall back to a centered default normal geometry as the
    // un-maximize restore target.
    if geo.maximized && is_maximize_sized(app, geo.width, geo.height) {
        geo.width = DEFAULT_WIDTH;
        geo.height = DEFAULT_HEIGHT;
        if let Some((mw, mh, _, _)) = primary_monitor_work_area_logical(app) {
            geo.x = ((mw - DEFAULT_WIDTH) / 2.0).max(0.0);
            geo.y = ((mh - DEFAULT_HEIGHT) / 2.0).max(0.0);
        } else {
            geo.x = 0.0;
            geo.y = 0.0;
        }
    }

    if is_position_on_screen(app, geo.x, geo.y) && fits_on_any_monitor(app, geo.width, geo.height) {
        Some(geo)
    } else {
        None
    }
}

/// Returns the list of currently connected monitors.
///
/// Silently returns an empty list if the monitor query fails,
/// which causes position/size validation checks to fail safely.
fn available_monitors(app: &AppHandle) -> Vec<tauri::Monitor> {
    app.available_monitors().unwrap_or_default()
}

/// Returns true if the given logical dimensions are at least as large as some
/// monitor's work area — i.e. the size corresponds to a maximized window, not
/// a normal user-chosen size.
///
/// Why: maximize() can dispatch its Resized event before is_maximized() flips
/// to true, so without this guard a maximized window would be persisted with
/// work-area-sized bounds as the "normal" geometry, corrupting the real normal
/// size. It also self-heals store entries written that way by older versions.
fn is_maximize_sized(app: &AppHandle, width: f64, height: f64) -> bool {
    available_monitors(app).iter().any(|m| {
        let work = m.work_area();
        let scale = m.scale_factor();
        let work_w = work.size.width as f64 / scale;
        let work_h = work.size.height as f64 / scale;
        width >= work_w && height >= work_h
    })
}

/// Checks whether the given logical coordinates fall within any monitor's bounds.
///
/// Converts physical monitor positions/sizes to logical coordinates using
/// each monitor's scale factor before performing the hit test.
fn is_position_on_screen(app: &AppHandle, x: f64, y: f64) -> bool {
    // Why: Windows has an invisible resize border (~7 physical px), so a
    // window snapped to the screen's left/top edge reports a slightly negative
    // outer_position. Strictly rejecting that marks the saved geometry as
    // "offscreen" and falls back to defaults, losing both size and position
    // restore (surfaces after Win+arrow snap or un-maximize). Allow a small
    // physical-px margin in the negative direction to tolerate this.
    const OFFSCREEN_MARGIN_PHYSICAL_PX: f64 = 16.0;
    available_monitors(app).iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        let scale = m.scale_factor();
        let mx = pos.x as f64 / scale;
        let my = pos.y as f64 / scale;
        let mw = size.width as f64 / scale;
        let mh = size.height as f64 / scale;
        // Why: ~7px border in physical pixels; allow 16 physical px (covers
        // high-DPI scales) converted to logical per monitor.
        let margin = OFFSCREEN_MARGIN_PHYSICAL_PX / scale;

        x >= mx - margin && x < mx + mw && y >= my - margin && y < my + mh
    })
}

/// Checks whether the given logical dimensions fit within any single monitor.
///
/// Used to prevent restoring a window size that would be larger than
/// all connected monitors (e.g., after disconnecting an external display).
fn fits_on_any_monitor(app: &AppHandle, width: f64, height: f64) -> bool {
    available_monitors(app).iter().any(|m| {
        let size = m.size();
        let scale = m.scale_factor();
        let mw = size.width as f64 / scale;
        let mh = size.height as f64 / scale;

        width <= mw && height <= mh
    })
}
