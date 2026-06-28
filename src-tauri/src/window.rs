//! Window creation and geometry persistence.
//!
//! Creates the main application window programmatically with saved geometry
//! to prevent the startup size flash that occurs when using tauri.conf.json
//! defaults followed by async resize via tao's dispatch_async.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

const DEFAULT_WIDTH: f64 = 980.0;
const DEFAULT_HEIGHT: f64 = 609.0;
const MIN_WIDTH: f64 = 980.0;
const MIN_HEIGHT: f64 = 609.0;
const WINDOW_TITLE: &str = "Bilibili Downloader";
const GEOMETRY_STORE_KEY: &str = "windowGeometry";

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

/// Creates the main application window with saved or default geometry.
pub fn create_main_window(
    app: &AppHandle,
    theme: Option<Theme>,
) -> Result<(), Box<dyn std::error::Error>> {
    let geometry = read_saved_geometry(app);
    let should_maximize = geometry.as_ref().map(|g| g.maximized).unwrap_or(false);

    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title(WINDOW_TITLE)
        .theme(theme.or(Some(Theme::Light)))
        .resizable(false)
        .maximizable(false)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT);

    // CAUTION: Do NOT use builder.maximized(true). On macOS, tao implements
    // maximized by creating the window at inner_size, showing it, then calling
    // set_maximized async — which dispatches setFrame:display:animate:YES (or
    // NSWindow zoom:). Both branches animate and cannot be suppressed through
    // Tauri's public API, so the "normal-size -> maximized" resize is always
    // visible, even with visible(false)+show() (show() flushes the pending
    // animated frame change). This was confirmed against tao's
    // platform_impl/macos/util/async.rs.
    //
    // Instead, when the saved state is maximized, size the window to the
    // primary monitor's work area at construction time. No post-create resize
    // ever happens, so there is no animation. Trade-off: this yields a
    // "maximized-sized normal window" rather than a true isZoomed state, so
    // un-maximizing does not restore the previous size automatically.
    builder = if should_maximize {
        match primary_monitor_work_area_logical(app) {
            Some((w, h, x, y)) => builder.inner_size(w, h).position(x, y),
            None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT),
        }
    } else {
        match geometry {
            Some(geo) => builder
                .inner_size(geo.width, geo.height)
                .position(geo.x, geo.y),
            None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT),
        }
    };

    let window = builder.build()?;
    window.set_focus()?;
    Ok(())
}

/// Re-enables window resizing and maximizing after the splash screen completes.
///
/// The window is created with `resizable(false)` and `maximizable(false)` to
/// lock its geometry during the splash screen. This restores both so the user
/// can resize and maximize the main window once initialization is done.
#[tauri::command]
pub fn enable_window_resize(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Window not found")?;
    // Constraint: set_resizable MUST run before set_maximizable. When the window
    // is still non-resizable, Tauri/tao silently ignores set_maximizable on
    // Windows, so reversing the order would leave the maximize button disabled.
    window.set_resizable(true).map_err(|e| format!("{e}"))?;
    window.set_maximizable(true).map_err(|e| format!("{e}"))?;
    Ok(())
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

    // CAUTION: Under "Approach A", a maximized restore opens the window at the
    // primary monitor's work-area size as a normal (non-isZoomed) window, so
    // is_maximized() is false at launch. The construction-time sizing also
    // emits a Resized event, which would otherwise overwrite the user's real
    // normal geometry with the transient work-area bounds (silent data loss).
    // When the saved intent was maximized but the window isn't in a true
    // maximized state, skip persisting so the stored {normal geometry,
    // maximized: true} survives until the user maximizes (green button) or
    // explicitly resizes.
    let saved_was_maximized = read_raw_geometry(app).map(|g| g.maximized).unwrap_or(false);
    if !is_maximized && saved_was_maximized {
        return;
    }

    let geo = if is_maximized {
        // Persist only the flag; reuse the last normal geometry so un-maximizing
        // on next launch restores the real size instead of full-screen bounds.
        let prev = read_raw_geometry(app).unwrap_or(WindowGeometry {
            x: 0.0,
            y: 0.0,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            maximized: false,
        });
        WindowGeometry {
            maximized: true,
            ..prev
        }
    } else {
        let Ok(scale) = window.scale_factor() else {
            return;
        };
        let Ok(pos) = window.outer_position() else {
            return;
        };
        let Ok(size) = window.inner_size() else {
            return;
        };
        WindowGeometry {
            x: pos.x as f64 / scale,
            y: pos.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
            maximized: false,
        }
    };

    if let Ok(store) = app.store("window-state.json") {
        store.set(
            GEOMETRY_STORE_KEY,
            serde_json::to_value(&geo).unwrap_or_default(),
        );
    }
}

/// Returns the primary monitor's work area in logical coordinates as
/// (width, height, x, y).
///
/// The work area excludes the taskbar/Dock and menu bar, so sizing the window
/// to it reproduces the "maximized" look at construction time without going
/// through tao's animated maximized API (see create_main_window). Returns None
/// if the primary monitor can't be queried.
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

/// Checks whether the given logical coordinates fall within any monitor's bounds.
///
/// Converts physical monitor positions/sizes to logical coordinates using
/// each monitor's scale factor before performing the hit test.
fn is_position_on_screen(app: &AppHandle, x: f64, y: f64) -> bool {
    available_monitors(app).iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        let scale = m.scale_factor();
        let mx = pos.x as f64 / scale;
        let my = pos.y as f64 / scale;
        let mw = size.width as f64 / scale;
        let mh = size.height as f64 / scale;

        x >= mx && x < mx + mw && y >= my && y < my + mh
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
