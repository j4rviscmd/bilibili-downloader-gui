//! Bilibili Downloader GUI - Core Library Module
//!
//! This module provides the core functionality for a Tauri-based desktop application
//! that downloads videos from Bilibili. It handles video information retrieval,
//! downloads, cookie management, ffmpeg integration, and user settings.

use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager;

use crate::handlers::bilibili;
use crate::handlers::cleanup;
use crate::handlers::cookie;
use crate::handlers::favorites;
use crate::handlers::ffmpeg;
use crate::handlers::github;
use crate::handlers::settings;
use crate::handlers::updater;
use crate::models::cookie::CookieCache;
#[cfg(debug_assertions)]
use crate::models::cookie::SimulateLogoutFlag;
use crate::models::frontend_dto::FavoriteFolder;
use crate::models::frontend_dto::FavoriteVideoListResponse;
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
pub use utils::wbi;

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
/// - `get_release_notes`: Fetches release notes from GitHub API
/// - `get_repo_stars`: Fetches star count for a GitHub repository
///
/// # Panics
///
/// Panics if the Tauri application fails to run.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Build Tauri builder with plugins
    // Window state plugin is only enabled in release builds to prevent
    // window position restoration during development
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
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
            cancel_download,
            cancel_all_downloads,
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
            get_release_notes,
            get_repo_stars,
            fetch_favorite_folders,
            fetch_favorite_videos,
            fetch_watch_history,
            cleanup_temp_files,
            // record_download_click  // NOTE: GA4 Analytics は無効化されています
            #[cfg(debug_assertions)]
            set_simulate_logout,
        ])
        // 開発環境以外で`app`宣言ではBuildに失敗するため、`_app`を使用
        .setup(|app| {
            // Cookieキャッシュを初期化
            app.manage(CookieCache::default());

            // Development mode: Initialize simulate logout flag
            #[cfg(debug_assertions)]
            {
                app.manage(SimulateLogoutFlag::default());
            }

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
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }

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
    cookie::get_cookie(&app).await.map_err(|e| e.to_string())
}

/// Fetches the logged-in user information from Bilibili.
///
/// This command retrieves the current user's profile information using
/// cached cookies. Returns a User object with `has_cookie` indicating
/// whether valid cookies are available.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns a User object with user profile data if cookies are available,
/// or a User object with `has_cookie: false` if no cookies are found.
///
/// # Errors
///
/// Returns an error if:
/// - The API request fails (when cookies are available)
/// - Response parsing fails (when cookies are available)
#[tauri::command]
async fn fetch_user(app: AppHandle) -> Result<User, String> {
    bilibili::fetch_user_info(&app)
        .await
        .map_err(|e| e.to_string())
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
    bilibili::fetch_video_info(&app, &video_id)
        .await
        .map_err(|e| e.to_string())
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
/// - Download is cancelled (`ERR::CANCELLED`)
#[tauri::command]
async fn download_video(
    app: AppHandle,
    options: bilibili::DownloadOptions,
) -> Result<String, String> {
    bilibili::download_video(&app, &options).await
}

/// Cancels a specific download by its ID.
///
/// This command signals the download to stop and cleans up any temporary files.
/// The download will receive an `ERR::CANCELLED` error and emit a
/// `download_cancelled` event to the frontend.
///
/// # Arguments
///
/// * `download_id` - Unique identifier of the download to cancel
///
/// # Returns
///
/// Returns `Ok(true)` if the download was found and cancelled,
/// `Ok(false)` if the download was not found (may have already completed).
///
/// # Example
///
/// ```typescript
/// const wasCancelled = await invoke<boolean>('cancel_download', { downloadId: 'BV123-p1' });
/// ```
#[tauri::command]
async fn cancel_download(app: AppHandle, download_id: String) -> Result<bool, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;
    use tauri::Emitter;

    // Signal cancellation
    let was_found = DOWNLOAD_CANCEL_REGISTRY.cancel(&download_id).await;

    if was_found {
        // Emit cancellation event to frontend
        let _ = app.emit(
            "download_cancelled",
            serde_json::json!({ "downloadId": download_id }),
        );
    }

    Ok(was_found)
}

/// Cancels all active downloads.
///
/// This command signals all in-progress downloads to stop and cleans up
/// their temporary files. Each cancelled download will emit a
/// `download_cancelled` event to the frontend.
///
/// # Returns
///
/// Returns the number of downloads that were cancelled.
///
/// # Example
///
/// ```typescript
/// const count = await invoke<number>('cancel_all_downloads');
/// ```
#[tauri::command]
async fn cancel_all_downloads(app: AppHandle) -> Result<usize, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;
    use tauri::Emitter;

    // Get all active download IDs before cancelling
    let download_ids = DOWNLOAD_CANCEL_REGISTRY.get_all_ids().await;

    // Cancel all downloads
    let count = DOWNLOAD_CANCEL_REGISTRY.cancel_all().await;

    // Emit cancellation events for each download
    for download_id in download_ids {
        let _ = app.emit(
            "download_cancelled",
            serde_json::json!({ "downloadId": download_id }),
        );
    }

    Ok(count)
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
    settings::get_settings(&app)
        .await
        .map_err(|e| e.to_string())
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
            let mut csv = String::from(
                "id,title,bvid,url,downloaded_at,status,file_size,quality,thumbnail_url,version\n",
            );
            for entry in entries {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{},{},{},{}\n",
                    escape_csv(&entry.id),
                    escape_csv(&entry.title),
                    entry.bvid.as_deref().map(escape_csv).unwrap_or_default(),
                    escape_csv(&entry.url),
                    escape_csv(&entry.downloaded_at),
                    escape_csv(&entry.status),
                    entry.file_size.map_or(String::new(), |s| s.to_string()),
                    entry.quality.as_deref().map(escape_csv).unwrap_or_default(),
                    entry.thumbnail_url.as_deref().map(escape_csv).unwrap_or_default(),
                    escape_csv(&entry.version),
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

/// Fetches all release notes from GitHub for versions newer than current.
///
/// This command retrieves all releases from the GitHub repository,
/// filters them to include only versions newer than the current version,
/// and merges their release notes into a single Markdown document.
///
/// # Arguments
///
/// * `owner` - Repository owner (e.g., "j4rviscmd")
/// * `repo` - Repository name (e.g., "bilibili-downloader-gui")
/// * `current_version` - Current application version (e.g., "1.1.0")
///
/// # Returns
///
/// Returns merged release notes for all newer versions as a Markdown-formatted string.
///
/// # Errors
///
/// Returns an error if:
/// - The GitHub API request fails (network issues, rate limit, etc.)
/// - The current version cannot be parsed as semver
///
/// # Example
///
/// ```rust
/// let notes = get_release_notes("j4rviscmd", "bilibili-downloader-gui", "1.1.0").await?;
/// // notes contains Markdown formatted release notes for all newer versions
/// ```
#[tauri::command]
async fn get_release_notes(
    owner: String,
    repo: String,
    current_version: String,
) -> Result<String, String> {
    updater::fetch_all_release_notes(&owner, &repo, &current_version)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches the star count for a GitHub repository.
///
/// This command retrieves the current stargazers count for the specified
/// repository via the GitHub API. No authentication is required for public
/// repositories.
///
/// # Arguments
///
/// * `owner` - Repository owner (e.g., "j4rviscmd")
/// * `repo` - Repository name (e.g., "bilibili-downloader-gui")
///
/// # Returns
///
/// Returns the star count as a number.
///
/// # Errors
///
/// Returns an error if:
/// - The GitHub API request fails (network issues, rate limit exceeded)
/// - The repository is not found or private
/// - Invalid owner/repo parameters
///
/// # Example
///
/// ```rust
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// use tauri::AppHandle;
///
/// # let app: AppHandle = unimplemented!();
/// let stars = get_repo_stars("j4rviscmd", "bilibili-downloader-gui".to_string()).await?;
/// println!("Stars: {}", stars);
/// # Ok(())
/// # }
/// ```
#[tauri::command]
async fn get_repo_stars(owner: String, repo: String) -> Result<usize, String> {
    github::fetch_repo_stars(&owner, &repo)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches all favorite folders for the logged-in user.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `mid` - User's member ID
///
/// # Returns
///
/// List of favorite folders with metadata.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable (`ERR::COOKIE_MISSING`)
/// - API request fails
#[tauri::command]
async fn fetch_favorite_folders(app: AppHandle, mid: i64) -> Result<Vec<FavoriteFolder>, String> {
    favorites::fetch_favorite_folders(&app, mid)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches videos from a specific favorite folder with pagination.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `media_id` - Favorite folder ID
/// * `page_num` - Page number (1-indexed)
/// * `page_size` - Number of items per page (max 20)
///
/// # Returns
///
/// Paginated list of videos with metadata.
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable (`ERR::COOKIE_MISSING`)
/// - API request fails
#[tauri::command]
async fn fetch_favorite_videos(
    app: AppHandle,
    media_id: i64,
    page_num: i32,
    page_size: i32,
) -> Result<FavoriteVideoListResponse, String> {
    favorites::fetch_favorite_videos(&app, media_id, page_num, page_size)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches watch history from Bilibili with pagination support.
///
/// This command retrieves the user's viewing history from Bilibili.
/// Requires valid Bilibili cookies for authentication.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing cookie cache
/// * `max` - Maximum number of entries to fetch (0 for default, typically 20)
/// * `view_at` - Timestamp cursor for pagination (0 for first page)
///
/// # Returns
///
/// Returns a `WatchHistoryResponse` containing:
/// - `entries`: List of watch history entries with video metadata
/// - `cursor`: Pagination cursor for fetching more entries
///
/// # Errors
///
/// Returns an error if:
/// - Cookies are unavailable (`ERR::COOKIE_MISSING`)
/// - User is not logged in (`ERR::UNAUTHORIZED`)
/// - HTTP request fails
/// - Response parsing fails
#[tauri::command]
async fn fetch_watch_history(
    app: AppHandle,
    max: i32,
    view_at: i64,
) -> Result<bilibili::WatchHistoryResponse, String> {
    bilibili::fetch_watch_history(&app, max, view_at).await
}

/// Cleans up orphaned temporary files from interrupted downloads.
///
/// Scans the lib directory for temp files matching:
/// - `temp_video_*.m4s`
/// - `temp_audio_*.m4s`
///
/// Files older than 24 hours are deleted. This is a fire-and-forget
/// operation that logs errors instead of returning them.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing lib path
///
/// # Returns
///
/// Returns a `CleanupResult` containing:
/// - `deleted_count`: Number of files successfully deleted
/// - `failed_count`: Number of files that failed to delete
#[tauri::command]
async fn cleanup_temp_files(app: AppHandle) -> Result<cleanup::CleanupResult, String> {
    Ok(cleanup::cleanup_temp_files(&app, None))
}

/// Sets the simulate logout flag for development mode.
///
/// When enabled, all API requests will behave as if the user is not logged in,
/// regardless of whether valid cookies are present. This allows testing
/// non-logged-in user behavior without actually clearing cookies.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the flag state
/// * `enabled` - Whether to enable or disable the simulate logout flag
///
/// # Returns
///
/// Returns `Ok(())` on success.
///
/// # Errors
///
/// Returns an error if the flag state cannot be accessed.
///
/// # Note
///
/// This command is only available in debug builds. Calling it in release
/// builds will result in a "command not found" error.
#[cfg(debug_assertions)]
#[tauri::command]
async fn set_simulate_logout(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(flag) = app.try_state::<SimulateLogoutFlag>() {
        if let Ok(mut guard) = flag.enabled.lock() {
            *guard = enabled;
            return Ok(());
        }
    }
    Err("Failed to access simulate logout state".to_string())
}
