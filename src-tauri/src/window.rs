//! Window creation and geometry persistence.
//!
//! Creates the main application window programmatically with saved geometry
//! to prevent the startup size flash that occurs when using tauri.conf.json
//! defaults followed by async resize via tao's dispatch_async.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
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
}

/// Creates the main application window with saved or default geometry.
///
/// Reads saved geometry from the store and creates the window at the
/// correct size from the start, avoiding the resize flash caused by
/// tao's async `setContentSize:` on macOS.
pub fn create_main_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let geometry = read_saved_geometry(app);

    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title(WINDOW_TITLE)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT);

    builder = match geometry {
        Some(geo) => builder
            .inner_size(geo.width, geo.height)
            .position(geo.x, geo.y),
        None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT),
    };

    let window = builder.build()?;
    window.set_focus()?;
    Ok(())
}

/// Saves the current window geometry to the store.
pub fn save_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };

    let geo = WindowGeometry {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };

    if let Ok(store) = app.store("window-state.json") {
        store.set(
            GEOMETRY_STORE_KEY,
            serde_json::to_value(&geo).unwrap_or_default(),
        );
    }
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
