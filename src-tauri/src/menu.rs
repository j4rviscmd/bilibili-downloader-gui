//! macOS application menu with a native About item.
//!
//! On macOS, installing an explicit app menu replaces the OS-default menu
//! entirely. To keep standard shortcuts working (Cmd+Q, Cmd+C/V, window
//! controls) we rebuild the Application/Edit/Window menus with
//! `SubmenuBuilder` helpers so the OS retains native behavior for each
//! entry, and the About item opens the native About sheet populated from
//! `AboutMetadata`.
//!
//! CONSTRAINT: macOS-only. `.services()` and the Application-submenu
//! convention are macOS concepts, and installing a menu bar on
//! Windows/Linux would add an unwanted bar across the window.

#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager};

/// Display name shown in the macOS app menu and About sheet. Hardcoded
/// because `package_info().name` mirrors `tauri.conf.json`'s kebab-case
/// `productName` ("bilibili-downloader-gui"), which is not the branded
/// title-case name users expect to see in native UI.
#[cfg(target_os = "macos")]
const DISPLAY_NAME: &str = "Bilibili Downloader GUI";

/// Builds and installs the macOS app menu.
///
/// The first submenu becomes the application menu (titled with the app
/// name); its About entry opens the native About sheet populated from
/// `AboutMetadata` (name + version).
#[cfg(target_os = "macos")]
pub fn install_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let version = app.package_info().version.to_string();

    // Application menu. Order matters on macOS (About, Services, Hide,
    // Quit) so the OS can wire the expected accelerators (Cmd+H, Cmd+Q).
    let app_menu = SubmenuBuilder::new(app, DISPLAY_NAME)
        .about(Some(AboutMetadata {
            name: Some(DISPLAY_NAME.to_string()),
            version: Some(version),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // Edit menu keeps Cmd+Z/C/X/V/A working inside the webview. Without
    // it, rebuilding the app menu would drop macOS's default edit menu
    // and text editing shortcuts would stop firing.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Window menu: Minimize/Zoom/Close (Cmd+M, Cmd+W).
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .zoom()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
