//! Firefox Cookie Management
//!
//! This module handles reading cookies from Firefox's SQLite database
//! and caching them in memory for use in API requests to Bilibili.
//!
//! # Overview
//!
//! The cookie pipeline proceeds in three stages:
//! 1. Locate the active Firefox profile via `profiles.ini` (or a filesystem
//!    scan fallback when the ini is missing/unparseable).
//! 2. Copy `cookies.sqlite` into a temp directory to avoid read locks while
//!    Firefox is running, then query Bilibili entries from it.
//! 3. Populate the global [`CookieCache`] so the rest of the backend can
//!    inject the cookie header on outgoing Bilibili API requests.

use std::{collections::HashMap, fs, path::PathBuf};

use rusqlite::{Connection, Result as SqlResult};
use tauri::AppHandle;
use tauri::Manager;

use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;
#[cfg(debug_assertions)]
use crate::models::cookie::SimulateLogoutFlag;

/// Reads cookies from the application's memory cache.
///
/// This function retrieves cached cookies without accessing the Firefox database.
/// Cookies must be fetched first using `get_cookie()`.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns `Ok(Some(cookies))` if cookies are cached, `Ok(None)` if the cache is empty.
/// Returns `Ok(Some([]))` if simulate logout flag is enabled (development mode only).
///
/// # Errors
///
/// Returns an error if the cache state cannot be accessed (should not normally occur).
pub fn read_cookie(app: &AppHandle) -> Result<Option<Vec<CookieEntry>>, String> {
    // Development mode: check if simulate logout is enabled
    #[cfg(debug_assertions)]
    {
        if let Some(flag) = app.try_state::<SimulateLogoutFlag>() {
            if let Ok(enabled) = flag.enabled.lock() {
                if *enabled {
                    return Ok(Some(vec![]));
                }
            }
        }
    }

    // Retrieve from cache via app.state::<CookieCache>().cookies.lock()
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(guard) = cache.cookies.lock() {
            let cookies = guard.clone();
            return Ok(Some(cookies));
        }
    }
    Ok(None)
}

/// Resolves the Firefox root directory (where `profiles.ini` lives) in a
/// platform-specific location.
///
/// Note: this is the Firefox root, not the directory containing profile
/// folders. On Windows and macOS, profiles live under a `Profiles`
/// subdirectory of the returned path; on Linux they sit directly inside it.
fn firefox_root_dir(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        let appdata = app.path().data_dir().ok()?;
        Some(appdata.join("Mozilla/Firefox"))
    } else if cfg!(target_os = "macos") {
        let home = app.path().home_dir().ok()?;
        Some(home.join("Library/Application Support/Firefox"))
    } else if cfg!(target_os = "linux") {
        let home = app.path().home_dir().ok()?;
        Some(home.join(".mozilla/firefox"))
    } else {
        None
    }
}

/// Returns the directory that directly contains profile folders on the
/// current platform. Used by the filesystem-scan fallback when `profiles.ini`
/// cannot be parsed.
fn firefox_profiles_container(app: &AppHandle) -> Option<PathBuf> {
    let root = firefox_root_dir(app)?;
    if cfg!(target_os = "linux") {
        Some(root)
    } else {
        Some(root.join("Profiles"))
    }
}

/// Parses `profiles.ini` to identify the active Firefox profile directory.
///
/// Modern Firefox installs use `[Install*]` sections with a `Default=` key
/// pointing to the active profile; legacy layouts use `[Profile*]` sections
/// with `Default=1` on the chosen profile and its path in `Path=`. Relative
/// paths in the ini file (e.g. `Profiles/xxx` on Windows/macOS or just
/// `xxx.default` on Linux) are resolved against the Firefox root. Absolute
/// paths (when `IsRelative=0`) are used as-is.
///
/// Returns `None` when the ini file is missing, unparseable, or points at a
/// profile without a `cookies.sqlite` file. The caller is expected to fall
/// back to a filesystem scan in that case.
fn find_active_firefox_profile(firefox_root: &std::path::Path) -> Option<PathBuf> {
    let ini_path = firefox_root.join("profiles.ini");
    let content = fs::read_to_string(&ini_path).ok()?;

    // Single-pass collection. Firefox writes `Path=` and `Default=1` in
    // either order within a `[Profile*]` section, so capture all entries
    // and reconcile them at the end.
    let mut last_install_default: Option<String> = None;
    let mut profile_paths: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut default_profile_section: Option<String> = None;
    let mut current_section = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed.to_string();
            continue;
        }
        if current_section.starts_with("[Install") {
            if let Some(rest) = trimmed.strip_prefix("Default=") {
                last_install_default = Some(rest.trim().to_string());
            }
        } else if current_section.starts_with("[Profile") {
            if let Some(rest) = trimmed.strip_prefix("Path=") {
                profile_paths.insert(current_section.clone(), rest.trim().to_string());
            } else if trimmed == "Default=1" {
                default_profile_section = Some(current_section.clone());
            }
        }
    }

    // Resolve an ini path entry: absolute paths are used as-is, relative
    // paths are joined to the Firefox root. `IsRelative` is intentionally
    // not consulted because Firefox encodes absolute paths verbatim and
    // the presence of a leading separator is a reliable signal on every
    // supported platform.
    let resolve = |rel: &str| -> PathBuf {
        let p = std::path::Path::new(rel);
        if p.is_absolute() {
            PathBuf::from(rel)
        } else {
            firefox_root.join(rel)
        }
    };

    // Priority 1: last [Install*] section's Default= value.
    if let Some(rel) = last_install_default {
        let candidate = resolve(&rel);
        if candidate.join("cookies.sqlite").is_file() {
            log::info!(
                "[BE] find_active_firefox_profile: resolved via [Install*]: {}",
                candidate.display()
            );
            return Some(candidate);
        }
    }

    // Priority 2: [Profile*] section marked Default=1, look up its Path=.
    if let Some(section) = default_profile_section {
        if let Some(rel) = profile_paths.get(&section) {
            let candidate = resolve(rel);
            if candidate.join("cookies.sqlite").is_file() {
                log::info!(
                    "[BE] find_active_firefox_profile: resolved via [Profile*] Default=1: {}",
                    candidate.display()
                );
                return Some(candidate);
            }
        }
    }

    None
}

/// Locates the Firefox cookies.sqlite file on the system.
///
/// Prefers the active profile identified by `profiles.ini`. Falls back to a
/// directory scan picking the first `cookies.sqlite` found when the ini file
/// is missing or does not resolve to a usable profile.
///
/// # Arguments
///
/// * `app` - Tauri application handle for resolving home directory paths
///
/// # Returns
///
/// Returns `Some(PathBuf)` pointing to the cookies.sqlite file if found,
/// or `None` if Firefox is not installed or the file cannot be located.
fn find_firefox_cookie_file(app: &AppHandle) -> Option<PathBuf> {
    let firefox_root = firefox_root_dir(app)?;

    if !firefox_root.exists() {
        return None;
    }

    if let Some(profile) = find_active_firefox_profile(&firefox_root) {
        let cookiefile = profile.join("cookies.sqlite");
        if cookiefile.is_file() {
            return Some(cookiefile);
        }
    }

    log::warn!(
        "[BE] find_firefox_cookie_file: profiles.ini lookup failed, falling back to directory scan"
    );
    let container = firefox_profiles_container(app)?;
    if let Ok(entries) = fs::read_dir(&container) {
        for entry in entries.flatten() {
            let p = entry.path().join("cookies.sqlite");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Extracts Bilibili cookies from Firefox and caches them in memory.
///
/// This function:
/// 1. Locates the Firefox cookies.sqlite database
/// 2. Copies it to a temporary location (to avoid file locks)
/// 3. Reads Bilibili-specific cookies from the database
/// 4. Caches the cookies in application memory for subsequent use
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing the cookie cache
///
/// # Returns
///
/// Returns `Ok(true)` if Bilibili cookies were found and cached,
/// `Ok(false)` if no Bilibili cookies were found.
///
/// # Errors
///
/// Returns an error if:
/// - Firefox cookies database cannot be copied
/// - SQLite database cannot be opened or queried
pub async fn get_cookie(app: &AppHandle) -> Result<bool, String> {
    log::info!("[BE] get_cookie: reading cookies from Firefox");
    // 1) Search for local Firefox cookie DB
    let Some(cookiefile) = find_firefox_cookie_file(app) else {
        log::warn!("[BE] get_cookie: Firefox cookie file not found");
        return Ok(false);
    };

    // 2) Copy to temp directory (to avoid lock while Firefox is running)
    let tmp_dir = std::env::temp_dir();
    let tmp_cookie = tmp_dir.join("temp_cookiefile.sqlite");
    fs::copy(&cookiefile, &tmp_cookie).map_err(|e| format!("failed to copy cookie db: {e}"))?;

    // 3) Open SQLite and read host, name, value from moz_cookies (for debug display)
    let mut cookies = HashMap::<String, String>::new();
    let has_any = read_bilibili_cookies(&tmp_cookie, &mut cookies)
        .map_err(|e| format!("sqlite read error: {e}"))?;

    log::info!(
        "[BE] get_cookie: successfully loaded {} cookies",
        cookies.len()
    );

    // Save to memory cache
    // NOTE: To read the cache later, access via app.state::<CookieCache>().cookies.lock()
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(mut guard) = cache.cookies.lock() {
            *guard = cookies
                .into_iter()
                .map(|(name, value)| CookieEntry {
                    host: ".bilibili.com".to_string(),
                    name,
                    value,
                })
                .collect();
        }
    }

    Ok(has_any)
}

/// Reads Bilibili cookies from the copied SQLite database into the given map.
///
/// Returns `true` if at least one Bilibili cookie was found.
fn read_bilibili_cookies(
    db_path: &std::path::Path,
    cookies: &mut HashMap<String, String>,
) -> SqlResult<bool> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT host, name, value FROM moz_cookies")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut count = 0usize;
    for row in rows {
        let (host, name, value) = row?;
        if host == "bilibili.com" || host.ends_with(".bilibili.com") {
            cookies.insert(name, value);
            count += 1;
        }
    }
    Ok(count > 0)
}
