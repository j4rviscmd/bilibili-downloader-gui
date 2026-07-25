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
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::AppHandle;

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
    // Application menu. Order matters on macOS (About, Services, Hide,
    // Quit) so the OS can wire the expected accelerators (Cmd+H, Cmd+Q).
    //
    // The About entry is a custom MenuItem (id "about") instead of the
    // native `.about()` helper, so a click emits the `menu:about` event
    // (handled in lib.rs) and opens the in-app About dialog. The native
    // About sheet can only render name/version/copyright/icon, whereas the
    // in-app dialog shows the full environment info (OS/arch/Tauri/repo)
    // — matching Settings → About.
    let app_menu = SubmenuBuilder::new(app, DISPLAY_NAME)
        .text("about", format!("About {}", DISPLAY_NAME))
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
    //
    // SubmenuBuilder exposes no zoom() helper, so build the Maximize
    // predefined item directly. On macOS, muda maps the Maximize
    // predefined type to the native window Zoom behavior (same as the
    // green title-bar button), keeping the standard Window menu intact.
    let zoom_item = PredefinedMenuItem::maximize(app, None)?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&zoom_item)
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
