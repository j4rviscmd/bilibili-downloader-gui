//! Firefox Cookie Management
//!
//! This module handles reading cookies from Firefox's SQLite database
//! and caching them in memory for use in API requests to Bilibili.

use std::{collections::HashMap, fs, path::PathBuf};

use rusqlite::{Connection, Result as SqlResult};
use tauri::AppHandle;
use tauri::Manager;

use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;

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
///
/// # Errors
///
/// Returns an error if the cache state cannot be accessed (should not normally occur).
pub fn read_cookie(app: &AppHandle) -> Result<Option<Vec<CookieEntry>>, String> {
    // キャッシュを参照する場合は、app.state::<CookieCache>().cookies.lock() から取出
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(guard) = cache.cookies.lock() {
            let cookies = guard.clone();
            return Ok(Some(cookies));
        }
    }
    Ok(None)
}

/// Locates the Firefox cookies.sqlite file on the system.
///
/// This function searches for the Firefox cookies database in platform-specific
/// default locations. Supports Windows, macOS, and Linux.
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
    let filepath = if cfg!(target_os = "windows") {
        let appdata = app.path().data_dir().ok()?;
        appdata.join("Mozilla/Firefox/Profiles")
    } else if cfg!(target_os = "macos") {
        let home = app.path().home_dir().ok()?;
        home.join("Library/Application Support/Firefox/Profiles")
    } else if cfg!(target_os = "linux") {
        // Linux: ~/.mozilla/firefox
        let home = app.path().home_dir().ok()?;
        home.join(".mozilla/firefox")
    } else {
        return None;
    };

    if !filepath.exists() {
        return None;
    }
    // プロファイル配下を走査して最初に見つかった cookies.sqlite を返す
    if let Ok(entries) = fs::read_dir(&filepath) {
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
    // 1) ローカルの Firefox cookie DB を探索
    let Some(cookiefile) = find_firefox_cookie_file(app) else {
        return Ok(false);
    };

    // 2) 一時ディレクトリにコピー（Firefox 実行中ロック対策）
    let tmp_dir = std::env::temp_dir();
    let tmp_cookie = tmp_dir.join("temp_cookiefile.sqlite");
    fs::copy(&cookiefile, &tmp_cookie).map_err(|e| format!("failed to copy cookie db: {e}"))?;

    // 3) SQLite を開いて moz_cookies から host, name, value を読む（デバッグ表示）
    let mut cookies = HashMap::<String, String>::new();
    let read_res: SqlResult<bool> = (|| {
        let conn = Connection::open(&tmp_cookie)?;
        let mut stmt = conn.prepare("SELECT host, name, value FROM moz_cookies")?;
        let rows = stmt.query_map([], |row| {
            let host: String = row.get(0)?;
            let name: String = row.get(1)?;
            let value: String = row.get(2)?;
            Ok((host, name, value))
        })?;
        let mut count = 0usize;
        for row in rows {
            let (host, name, value) = row?;
            if host == ".bilibili.com" {
                cookies.insert(name, value);
                count += 1;
            }
        }
        Ok(count > 0)
    })();

    match read_res {
        Ok(has_any) => {
            // for (name, value) in cookies.iter() {
            //     println!("cookie: name={}, value={}", name, value);
            // }

            // メモリキャッシュへ保存
            // NOTE: 次回の処理でキャッシュを参照する場合は、app.state::<CookieCache>().cookies.lock() から取出
            if let Some(cache) = app.try_state::<CookieCache>() {
                if let Ok(mut guard) = cache.cookies.lock() {
                    let mut vec = Vec::with_capacity(cookies.len());
                    for (name, value) in cookies.into_iter() {
                        vec.push(CookieEntry {
                            host: ".bilibili.com".to_string(),
                            name,
                            value,
                        });
                    }
                    *guard = vec;
                }
            }

            Ok(has_any)
        }
        Err(e) => Err(format!("sqlite read error: {e}")),
    }
}
