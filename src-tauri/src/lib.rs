//! Bilibili Downloader GUI - Core Library Module
//!
//! This module provides the core functionality for a Tauri-based desktop application
//! that downloads videos from Bilibili. It handles video information retrieval,
//! downloads, cookie management, ffmpeg integration, and user settings.

use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager;

use crate::handlers::bilibili;
use crate::handlers::cookie;
use crate::handlers::ffmpeg;
use crate::handlers::settings;
use crate::models::cookie::CookieCache;
use crate::models::frontend_dto::User;
use crate::models::frontend_dto::Video;
use crate::models::history::HistoryEntry;
use crate::models::history::HistoryFilters;
use crate::models::settings::Settings;
use crate::store::HistoryStore;

pub mod constants;
pub mod emits;
pub mod handlers;
pub mod models;
pub mod store;
pub mod utils;

/// Initializes and runs the Tauri application.
///
/// This function configures the Tauri application with necessary plugins,
/// registers Tauri commands, and performs initial setup including developer
/// tools configuration in debug mode.
///
/// # Registered Tauri Commands
///
/// - `validate_ffmpeg`: Validates ffmpeg installation
/// - `install_ffmpeg`: Downloads and installs ffmpeg binary
/// - `get_cookie`: Retrieves cookies from Firefox
/// - `fetch_user`: Fetches user information from Bilibili
/// - `fetch_video_info`: Retrieves video metadata
/// - `download_video`: Downloads a video with specified quality
/// - `get_settings`: Retrieves application settings
/// - `set_settings`: Updates application settings
/// - `get_os`: Returns the current operating system identifier
/// - `get_history`: Retrieves all download history entries
/// - `add_history_entry`: Adds a new history entry
/// - `remove_history_entry`: Removes a history entry by ID
/// - `clear_history`: Clears all history entries
/// - `search_history`: Searches history with filters
/// - `export_history`: Exports history in JSON or CSV format
///
/// # Panics
///
/// Panics if the Tauri application fails to run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Build Tauri builder with plugins
    // Window state plugin is only enabled in release builds to prevent
    // window position restoration during development
    let builder = tauri::Builder::default()
        // .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        //     let _ = app
        //         .get_webview_window("main")
        //         .expect("no main window")
        //         .set_focus();
        // }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            validate_ffmpeg,
            install_ffmpeg,
            get_cookie,
            fetch_user,
            fetch_video_info,
            download_video,
            get_settings,
            set_settings,
            update_lib_path,
            get_current_lib_path,
            get_os,
            get_history,
            add_history_entry,
            remove_history_entry,
            clear_history,
            search_history,
            export_history,
            get_thumbnail_base64,
            reveal_in_folder,
            open_file,
            // record_download_click  // NOTE: GA4 Analytics は無効化されています
        ])
        // 開発環境以外で`app`宣言ではBuildに失敗するため、`_app`を使用
        .setup(|app| {
            // Cookieキャッシュを初期化
            app.manage(CookieCache::default());

            // Analytics 初期化 (非同期で失敗握りつぶし)
            // NOTE: GA4 Analytics は無効化されています
            // let handle: AppHandle = app.handle().clone();
            // tauri::async_runtime::spawn(async move {
            //     crate::utils::analytics::init_analytics(&handle).await;
            // });
            // 開発環境の場合は、開発者コンソールを有効化
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        });

    // Add window state plugin only in release builds
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Validates whether ffmpeg is properly installed and functional.
///
/// This command checks if the ffmpeg binary exists at the expected location
/// and verifies that it can be executed successfully.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns `true` if ffmpeg is installed and functional, `false` otherwise.
#[tauri::command]
async fn validate_ffmpeg(app: AppHandle) -> bool {
    // ffmpegの有効性チェック処理
    ffmpeg::validate_ffmpeg(&app)
}

/// Downloads and installs the ffmpeg binary for the current platform.
///
/// This command downloads the appropriate ffmpeg binary for Windows or macOS,
/// extracts it to the application library directory, and sets proper permissions.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns `Ok(true)` on successful installation, `Ok(false)` if the platform
/// is not supported, or an error message if the download/installation fails.
///
/// # Errors
///
/// Returns an error if:
/// - The download fails
/// - Extraction fails
/// - Permission setting fails (macOS)
#[tauri::command]
async fn install_ffmpeg(app: AppHandle) -> Result<bool, String> {
    ffmpeg::install_ffmpeg(&app)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieves Bilibili cookies from the local Firefox browser.
///
/// This command reads the Firefox cookies database, extracts Bilibili-related
/// cookies, and stores them in the application's memory cache for subsequent
/// API requests.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns `Ok(true)` if Bilibili cookies were found and cached successfully,
/// `Ok(false)` if no cookies were found.
///
/// # Errors
///
/// Returns an error if:
/// - Firefox cookies database cannot be accessed
/// - Database read operation fails
#[tauri::command]
async fn get_cookie(app: AppHandle) -> Result<bool, String> {
    // firefoxのCookie取得処理
    let res = cookie::get_cookie(&app).await.map_err(|e| e.to_string())?;

    Ok(res)
}

/// Fetches the logged-in user information from Bilibili.
///
/// This command retrieves the current user's profile information using
/// cached cookies. Returns `None` if no valid cookies are available.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns `Ok(Some(User))` if user information was successfully retrieved,
/// `Ok(None)` if no valid cookies are available.
///
/// # Errors
///
/// Returns an error if:
/// - The API request fails
/// - Response parsing fails
#[tauri::command]
async fn fetch_user(app: AppHandle) -> Result<Option<User>, String> {
    // firefoxのCookie取得処理
    let user = bilibili::fetch_user_info(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(user)
}

/// Retrieves comprehensive metadata for a Bilibili video.
///
/// This command fetches video information including title, parts, available
/// quality options, thumbnails, and duration for the specified video ID.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
/// * `video_id` - Bilibili video ID (BV identifier)
///
/// # Returns
///
/// Returns the video metadata including all parts and quality options.
///
/// # Errors
///
/// Returns an error if:
/// - No valid cookies are available
/// - The API request fails
/// - Response parsing fails
/// - Video is not found or inaccessible
#[tauri::command]
async fn fetch_video_info(app: AppHandle, video_id: String) -> Result<Video, String> {
    let res = bilibili::fetch_video_info(&app, &video_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

/// Downloads a Bilibili video with specified quality settings.
///
/// This command downloads the video and audio streams separately, then merges
/// them using ffmpeg. Progress updates are emitted to the frontend during
/// the download process.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `bvid` - Bilibili video ID (BV identifier)
/// * `cid` - Content ID for the specific video part
/// * `filename` - Desired output filename (extension is optional; .mp4 will be added if not present)
/// * `quality` - Video quality ID (e.g., 116 for 1080P60)
/// * `audio_quality` - Audio quality ID
/// * `download_id` - Unique identifier for tracking this download
/// * `parent_id` - Optional parent download ID for multi-part videos
///
/// # Returns
///
/// Returns the output file path on successful download and merge, or an error message.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are missing or invalid (`ERR::COOKIE_MISSING`)
/// - Selected quality is not available (`ERR::QUALITY_NOT_FOUND`)
/// - Disk space is insufficient (`ERR::DISK_FULL`)
/// - Download fails due to network issues (`ERR::NETWORK`)
/// - ffmpeg merge fails (`ERR::MERGE_FAILED`)
#[tauri::command]
async fn download_video(
    app: AppHandle,
    bvid: String,
    cid: i64,
    filename: String,
    quality: i32,
    audio_quality: i32,
    download_id: String,
) -> Result<String, String> {
    bilibili::download_video(
        &app,
        &bvid,
        cid,
        &filename,
        quality,
        audio_quality,
        download_id,
    )
    .await
}

/// Retrieves the current application settings.
///
/// This command loads settings from the settings.json file. If the file doesn't
/// exist, it creates one with default values. Falls back to the system's default
/// download directory if no custom path is configured.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns the current application settings.
///
/// # Errors
///
/// Returns an error if:
/// - Settings file cannot be read
/// - JSON parsing fails
#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let res = settings::get_settings(&app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(res)
}

/// Updates and persists the application settings.
///
/// This command validates and saves the provided settings to settings.json.
/// It verifies that the download output path exists and is a valid directory.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
/// * `settings` - New settings to be saved
///
/// # Returns
///
/// Returns `Ok(())` on successful save.
///
/// # Errors
///
/// Returns an error if:
/// - Download path is not set (`ERR:SETTINGS_PATH_NOT_SET`)
/// - Download path does not exist (`ERR:SETTINGS_PATH_NOT_EXIST`)
/// - Download path is not a directory (`ERR:SETTINGS_PATH_NOT_DIRECTORY`)
/// - File write fails
#[tauri::command]
async fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::set_settings(&app, &settings).await
}

/// Updates the library storage path and moves ffmpeg to the new location.
///
/// This command:
/// 1. Gets the current lib_path from settings (defaults to app_data_dir()/lib/)
/// 2. Moves ffmpeg from the old path to the new path with validation
/// 3. Updates settings.json with the new lib_path
/// 4. Returns an error on failure (original lib_path is preserved)
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing paths and settings
/// * `new_path` - New library path (used as-is for user-specified paths)
///
/// # Returns
///
/// Returns `Ok(())` on successful move and settings update.
///
/// # Errors
///
/// Returns an error if:
/// - Source ffmpeg validation fails
/// - Directory creation fails
/// - Copy operation fails
/// - Validation fails (new path is cleaned up)
/// - Settings update fails
#[tauri::command]
async fn update_lib_path(app: AppHandle, new_path: String) -> Result<(), String> {
    use crate::utils::paths;

    // Get current lib_path (or default)
    let current_settings = settings::get_settings(&app).await?;
    let _old_lib_path = current_settings
        .lib_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| paths::get_default_lib_path(&app));

    // Use the user-selected path as-is (no /lib suffix for user-specified paths)
    let new_lib_path = PathBuf::from(&new_path);

    // Get old and new ffmpeg root paths
    let old_ffmpeg_path = paths::get_ffmpeg_root_path(&app);

    // Determine new ffmpeg root path based on new lib path
    let new_ffmpeg_path = if cfg!(target_os = "windows") {
        new_lib_path.join("ffmpeg-master-latest-win64-lgpl-shared")
    } else {
        new_lib_path.join("ffmpeg")
    };

    // Move ffmpeg (if it exists)
    if old_ffmpeg_path.exists() {
        ffmpeg::move_ffmpeg(old_ffmpeg_path.clone(), new_ffmpeg_path)?;
    }

    // Update settings with new lib_path
    let mut updated_settings = current_settings;
    updated_settings.lib_path = new_lib_path.to_str().map(|s| s.to_string());

    settings::set_settings(&app, &updated_settings).await?;

    Ok(())
}

/// Returns the current library path.
///
/// This command returns the currently configured lib_path.
/// If no custom path is set, returns the default path (app_data_dir()/lib/).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns the current library path as a string.
#[tauri::command]
async fn get_current_lib_path(app: AppHandle) -> Result<String, String> {
    use crate::utils::paths;

    let lib_path = paths::get_lib_path(&app);
    lib_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert lib path to string".to_string())
}

/// Returns the current operating system identifier.
///
/// This command provides a normalized OS string that the frontend can use
/// for platform-specific logic.
///
/// # Returns
///
/// Returns one of: "windows", "macos", "linux", or other OS identifiers
/// as defined by Rust's `std::env::consts::OS`.
#[tauri::command]
async fn get_os() -> String {
    // Returns a normalized OS string used by frontend validation logic
    // std::env::consts::OS already returns one of: "windows", "macos", "linux", etc.
    std::env::consts::OS.to_string()
}

/// Retrieves all download history entries.
///
/// Returns all persisted history entries from the history store.
///
/// # Errors
///
/// Returns an error if the history store cannot be accessed.
#[tauri::command]
async fn get_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    Ok(store.get_all())
}

/// Adds a new entry to download history.
///
/// Persists a history entry to the history store. The entry is inserted
/// at the beginning of the history (newest first).
///
/// # Errors
///
/// Returns an error if:
/// - The entry data is invalid
/// - The history store cannot be written to
#[tauri::command]
async fn add_history_entry(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    store.add_entry(entry)
}

/// Removes a history entry by ID.
///
/// Deletes a single history entry from the history store.
///
/// # Errors
///
/// Returns an error if:
/// - The entry with the given ID is not found
/// - The history store cannot be written to
#[tauri::command]
async fn remove_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    store.remove_entry(&id)
}

/// Clears all download history entries.
///
/// Removes all history entries from the history store.
///
/// # Errors
///
/// Returns an error if the history store cannot be written to.
#[tauri::command]
async fn clear_history(app: AppHandle) -> Result<(), String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    store.clear()
}

/// Searches history entries with query and filters.
///
/// Searches through history entries using an optional query string and filters.
///
/// # Errors
///
/// Returns an error if the history store cannot be accessed.
#[tauri::command]
async fn search_history(
    app: AppHandle,
    query: Option<String>,
    filters: Option<HistoryFilters>,
) -> Result<Vec<HistoryEntry>, String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    Ok(store.search(query, filters))
}

/// Escapes a string value for RFC 4180 compliant CSV output.
///
/// Quotes the value if it contains commas, quotes, or newlines.
/// Embedded quotes are escaped by doubling them.
fn escape_csv(s: &str) -> String {
    let needs_quoting = s.contains(['"', ',', '\n', '\r']);
    if needs_quoting {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Exports history entries in JSON or CSV format.
///
/// Serializes all history entries to the specified format.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `format` - Export format: "json" or "csv"
///
/// # Returns
///
/// Returns the serialized data as a string.
///
/// # Errors
///
/// Returns an error if:
/// - The format is invalid
/// - Serialization fails
#[tauri::command]
async fn export_history(app: AppHandle, format: String) -> Result<String, String> {
    let store = HistoryStore::new(&app).map_err(|e| e.to_string())?;
    let entries = store.get_all();

    match format.as_str() {
        "json" => serde_json::to_string_pretty(&entries).map_err(|e| e.to_string()),
        "csv" => {
            let mut csv = String::from("id,title,url,status,downloaded_at,file_size,quality\n");
            for entry in entries {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{}\n",
                    escape_csv(&entry.id),
                    escape_csv(&entry.title),
                    escape_csv(&entry.url),
                    escape_csv(&entry.status),
                    escape_csv(&entry.downloaded_at),
                    entry.file_size.map_or(String::new(), |s| s.to_string()),
                    entry.quality.unwrap_or_default()
                ));
            }
            Ok(csv)
        }
        _ => Err(format!("Invalid format: {}. Supported: json, csv", format)),
    }
}

/// Fetches and encodes a thumbnail image as base64 data URL.
///
/// Downloads the image from the given URL and returns a base64-encoded
/// data URL that can be directly used in an `<img>` tag.
/// This bypasses Referer/CORS restrictions by using the backend to fetch.
///
/// # Arguments
///
/// * `url` - Thumbnail image URL (e.g., from Bilibili)
///
/// # Returns
///
/// Base64-encoded data URL (e.g., "data:image/jpeg;base64,...").
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - Response byte reading fails
/// - Base64 encoding fails
#[tauri::command]
async fn get_thumbnail_base64(url: String) -> Result<String, String> {
    crate::handlers::bilibili::get_thumbnail_base64(&url).await
}

/// Reveals a file in the system's file manager.
///
/// Opens the parent folder and selects the specified file.
/// Uses platform-specific commands for file manager integration.
///
/// # Arguments
///
/// * `path` - Absolute path to the file to reveal
///
/// # Returns
///
/// Returns `Ok(())` on success, or an error message if the operation fails.
///
/// # Errors
///
/// Returns an error if:
/// - The file does not exist
/// - The file manager cannot be opened
#[tauri::command]
async fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file on macOS: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file on Windows: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let file_uri = format!("file://{}", path);
        std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:{}", file_uri),
                "string:",
            ])
            .spawn()
            .map_err(|e| format!("Failed to reveal file on Linux: {}", e))?;
    }
    Ok(())
}

/// Opens a file with the system's default application.
///
/// # Arguments
///
/// * `path` - Absolute path to the file to open
///
/// # Returns
///
/// Returns `Ok(())` on success, or an error message if the operation fails.
///
/// # Errors
///
/// Returns an error if:
/// - The file does not exist
/// - No application is associated with the file type
#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file on macOS: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file on Windows: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file on Linux: {}", e))?;
    }
    Ok(())
}

// NOTE: GA4 Analytics は無効化されています
// #[tauri::command]
// async fn record_download_click(app: AppHandle, download_id: String) -> Result<(), String> {
//     tauri::async_runtime::spawn(async move {
//         crate::utils::analytics::record_download_click(&app, &download_id).await;
//     });
//     Ok(())
// }
