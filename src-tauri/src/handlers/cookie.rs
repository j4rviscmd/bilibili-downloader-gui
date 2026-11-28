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

#[cfg(target_os = "macos")]
use crate::handlers::{qr_login, settings};
use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;
#[cfg(debug_assertions)]
use crate::models::cookie::SimulateLogoutFlag;
#[cfg(any(target_os = "macos", test))]
use crate::models::settings::Settings;

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
// Why: generic over R — production callers pass AppHandle (= AppHandle<Wry>)
// while tests pass tauri::test::mock_app()'s AppHandle<MockRuntime>
// (tauri "test" dev-dependency feature, src-tauri/Cargo.toml); Manager<R> is
// the minimal bound covering both.
pub fn read_cookie<R: tauri::Runtime>(
    app: &impl Manager<R>,
) -> Result<Option<Vec<CookieEntry>>, String> {
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
fn firefox_profiles_container(firefox_root: &std::path::Path) -> PathBuf {
    if cfg!(target_os = "linux") {
        firefox_root.to_path_buf()
    } else {
        firefox_root.join("Profiles")
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
/// * `firefox_root` - directory containing `profiles.ini`
/// * `profiles_container` - directory holding the profile folders
///
/// # Returns
///
/// Returns `Ok(PathBuf)` pointing to the cookies.sqlite file if found,
/// `Err(NoCookies)` if Firefox is not installed or the file cannot be
/// located, or `Err(AccessDenied)` when the OS refuses to read the Firefox
/// data.
fn find_cookie_file(
    firefox_root: &std::path::Path,
    profiles_container: &std::path::Path,
) -> Result<PathBuf, CookieOutcome> {
    if let Some(profile) = find_active_firefox_profile(firefox_root) {
        return Ok(profile.join("cookies.sqlite"));
    }

    log::warn!("[BE] find_cookie_file: profiles.ini lookup failed, falling back to directory scan");
    let entries = fs::read_dir(profiles_container).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => CookieOutcome::AccessDenied,
        _ => CookieOutcome::NoCookies,
    })?;
    let mut denied = false;
    for entry in entries.flatten() {
        let p = entry.path().join("cookies.sqlite");
        // Why: Path::is_file() folds metadata errors (incl. PermissionDenied)
        // into `false`, silently downgrading a TCC denial to NoCookies;
        // fs::metadata() keeps the denial visible (see `denied` below).
        match fs::metadata(&p) {
            Ok(meta) if meta.is_file() => return Ok(p),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => denied = true,
            _ => {}
        }
    }
    if denied {
        return Err(CookieOutcome::AccessDenied);
    }
    Err(CookieOutcome::NoCookies)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CookieOutcome {
    Loaded,
    NoCookies,
    AccessDenied,
}

#[cfg(target_os = "macos")]
const FIREFOX_DATA_TCC_SERVICES: [&str; 2] = ["SystemPolicyAppDataDetailed", "SystemPolicyAppData"];

#[cfg(any(target_os = "macos", test))]
fn tccutil_reset_args(service: &str, bundle_id: &str) -> [String; 3] {
    [
        "reset".to_string(),
        service.to_string(),
        bundle_id.to_string(),
    ]
}

#[cfg(target_os = "macos")]
async fn reset_firefox_data_grant(bundle_id: &str) {
    for service in FIREFOX_DATA_TCC_SERVICES {
        match tokio::process::Command::new("/usr/bin/tccutil")
            .args(tccutil_reset_args(service, bundle_id))
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                log::info!("[BE] reset_firefox_data_grant: tccutil reset {service} done");
            }
            Ok(output) => log::warn!(
                "[BE] reset_firefox_data_grant: tccutil reset {service} failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            Err(e) => log::error!("[BE] reset_firefox_data_grant: tccutil reset {service}: {e}"),
        }
    }
}

// Why: the TCC reset is a one-shot migration, so it runs only until the
// done-flag is recorded; skipping when settings are unreadable keeps a broken
// settings store from re-running it every launch and re-clearing the grant
// the user just approved (Issue #985)
#[cfg(any(target_os = "macos", test))]
fn should_reset_firefox_data_grant(settings: Option<&Settings>) -> bool {
    settings.is_some_and(|s| s.firefox_permission_reset_done != Some(true))
}

#[cfg(any(target_os = "macos", test))]
fn firefox_permission_reset_done_patch() -> serde_json::Value {
    serde_json::json!({ "firefoxPermissionResetDone": true })
}

#[cfg(target_os = "macos")]
async fn reset_stale_firefox_data_grant(app: &AppHandle) {
    // Why: E2E runs (local-real and macOS CI) must not touch the host's real
    // TCC database — same constraint as init.rs's access-denied flag, which
    // stays false under E2E_TESTING or every spec hits a blocking dialog
    if qr_login::is_e2e_testing() {
        return;
    }
    let current = settings::get_settings(app).await.ok();
    if !should_reset_firefox_data_grant(current.as_ref()) {
        return;
    }

    reset_firefox_data_grant(&app.config().identifier).await;

    if let Err(e) = settings::patch_settings(app, firefox_permission_reset_done_patch()).await {
        log::error!("[BE] reset_stale_firefox_data_grant: failed to record the reset: {e}");
    }
}

pub async fn get_cookie(app: &AppHandle) -> Result<CookieOutcome, String> {
    let outcome = load_firefox_cookies(app).await?;
    // Why: an AccessDenied is the stale ad-hoc TCC record surfacing — records
    // minted under previous ad-hoc builds (a new designated requirement every
    // release) void the grant under the pinned identity. Clearing them once
    // on the first denial lets the user's next approval persist across
    // updates (Issue #985)
    #[cfg(target_os = "macos")]
    if outcome == CookieOutcome::AccessDenied {
        reset_stale_firefox_data_grant(app).await;
    }
    Ok(outcome)
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
/// Returns `Ok(Loaded)` if Bilibili cookies were found and cached,
/// `Ok(NoCookies)` if none were found, and `Ok(AccessDenied)` when the OS
/// refuses to read the Firefox data.
///
/// # Errors
///
/// Returns an error if:
/// - Firefox cookies database cannot be copied (other than a permission denial)
/// - SQLite database cannot be opened or queried
async fn load_firefox_cookies(app: &AppHandle) -> Result<CookieOutcome, String> {
    log::info!("[BE] get_cookie: reading cookies from Firefox");
    // 1) Search for local Firefox cookie DB
    let Some(firefox_root) = firefox_root_dir(app).filter(|root| root.exists()) else {
        return Ok(CookieOutcome::NoCookies);
    };
    let cookiefile =
        match find_cookie_file(&firefox_root, &firefox_profiles_container(&firefox_root)) {
            Ok(path) => path,
            Err(outcome) => {
                log::warn!("[BE] get_cookie: Firefox cookie file not found ({outcome:?})");
                return Ok(outcome);
            }
        };

    // 2) Copy to temp directory (to avoid lock while Firefox is running)
    let tmp_dir = std::env::temp_dir();
    let tmp_cookie = tmp_dir.join("temp_cookiefile.sqlite");
    if let Err(e) = fs::copy(&cookiefile, &tmp_cookie) {
        return match e.kind() {
            std::io::ErrorKind::PermissionDenied => Ok(CookieOutcome::AccessDenied),
            _ => Err(format!("failed to copy cookie db: {e}")),
        };
    }

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

    Ok(if has_any {
        CookieOutcome::Loaded
    } else {
        CookieOutcome::NoCookies
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn make_profile(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cookies.sqlite"), b"stub").unwrap();
        dir
    }

    fn write_ini(root: &Path, content: &str) {
        std::fs::write(root.join("profiles.ini"), content).unwrap();
    }

    #[test]
    fn resolves_via_install_section_default() {
        let root = tempfile::tempdir().unwrap();
        let expected = make_profile(root.path(), "abcd.default-release");
        write_ini(
            root.path(),
            "[InstallC3C80A9D53B24A61]\nDefault=abcd.default-release\nLock=abc\n",
        );
        assert_eq!(find_active_firefox_profile(root.path()), Some(expected));
    }

    #[test]
    fn install_section_ignored_when_cookies_missing() {
        // Points at a profile without cookies.sqlite -> falls through to None
        // (caller then directory-scans).
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("empty.profile")).unwrap();
        write_ini(root.path(), "[InstallX]\nDefault=empty.profile\n");
        assert_eq!(find_active_firefox_profile(root.path()), None);
    }

    #[test]
    fn resolves_via_profile_section_default_flag() {
        let root = tempfile::tempdir().unwrap();
        let expected = make_profile(root.path(), "second.default");
        make_profile(root.path(), "first.profile");
        // Default=1 written BEFORE Path= (order independence)
        write_ini(
            root.path(),
            "[Profile0]\nIsRelative=1\nPath=first.profile\n\n\
             [Profile1]\nDefault=1\nPath=second.default\n",
        );
        assert_eq!(find_active_firefox_profile(root.path()), Some(expected));
    }

    #[test]
    fn last_install_section_wins_over_profile_default() {
        let root = tempfile::tempdir().unwrap();
        let install_profile = make_profile(root.path(), "install.pick");
        make_profile(root.path(), "legacy.pick");
        write_ini(
            root.path(),
            "[Install1]\nDefault=install.pick\n\n\
             [Profile0]\nDefault=1\nPath=legacy.pick\n",
        );
        // Priority 1 ([Install*]) beats Priority 2 ([Profile*] Default=1)
        assert_eq!(
            find_active_firefox_profile(root.path()),
            Some(install_profile)
        );
    }

    #[test]
    fn missing_ini_or_file_yields_none() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(find_active_firefox_profile(root.path()), None);
    }

    #[test]
    fn garbage_ini_yields_none() {
        let root = tempfile::tempdir().unwrap();
        write_ini(root.path(), "not an ini file at all\n[broken\n");
        assert_eq!(find_active_firefox_profile(root.path()), None);
    }

    #[test]
    fn scan_fallback_returns_first_profile_cookie_file() {
        let root = tempfile::tempdir().unwrap();
        let container = root.path().join("Profiles");
        let profile = make_profile(&container, "first.default");
        assert_eq!(
            find_cookie_file(root.path(), &container),
            Ok(profile.join("cookies.sqlite"))
        );
    }

    #[test]
    fn missing_profiles_container_reports_no_cookies() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            find_cookie_file(root.path(), &root.path().join("Profiles")),
            Err(CookieOutcome::NoCookies)
        );
    }

    #[test]
    fn profile_without_cookie_file_reports_no_cookies() {
        let root = tempfile::tempdir().unwrap();
        let container = root.path().join("Profiles");
        std::fs::create_dir_all(container.join("empty.profile")).unwrap();
        assert_eq!(
            find_cookie_file(root.path(), &container),
            Err(CookieOutcome::NoCookies)
        );
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_profiles_dir_reports_access_denied() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let container = root.path().join("Profiles");
        make_profile(&container, "locked.default");
        write_ini(root.path(), "[InstallX]\nDefault=Profiles/locked.default\n");
        std::fs::set_permissions(&container, std::fs::Permissions::from_mode(0o000)).unwrap();

        assert_eq!(
            find_cookie_file(root.path(), &container),
            Err(CookieOutcome::AccessDenied)
        );

        std::fs::set_permissions(&container, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_profile_dir_reports_access_denied() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let container = root.path().join("Profiles");
        let profile = make_profile(&container, "locked.default");
        std::fs::set_permissions(&profile, std::fs::Permissions::from_mode(0o000)).unwrap();

        assert_eq!(
            find_cookie_file(root.path(), &container),
            Err(CookieOutcome::AccessDenied)
        );

        std::fs::set_permissions(&profile, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_profile_dir_does_not_mask_readable_profile() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let container = root.path().join("Profiles");
        let locked = make_profile(&container, "locked.default");
        let readable = make_profile(&container, "readable.default");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        assert_eq!(
            find_cookie_file(root.path(), &container),
            Ok(readable.join("cookies.sqlite"))
        );

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn cookie_outcome_serializes_camel_case() {
        assert_eq!(
            serde_json::to_value(CookieOutcome::Loaded).unwrap(),
            serde_json::json!("loaded")
        );
        assert_eq!(
            serde_json::to_value(CookieOutcome::NoCookies).unwrap(),
            serde_json::json!("noCookies")
        );
        assert_eq!(
            serde_json::to_value(CookieOutcome::AccessDenied).unwrap(),
            serde_json::json!("accessDenied")
        );
    }

    /// Creates a SQLite db with a moz_cookies table and the given
    /// (host, name, value) rows.
    fn make_cookie_db(path: &Path, rows: &[(&str, &str, &str)]) {
        let conn = Connection::open(path).unwrap();
        conn.execute(
            "CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT)",
            [],
        )
        .unwrap();
        for (host, name, value) in rows {
            conn.execute(
                "INSERT INTO moz_cookies (host, name, value) VALUES (?1, ?2, ?3)",
                rusqlite::params![host, name, value],
            )
            .unwrap();
        }
    }

    #[test]
    fn read_bilibili_cookies_filters_by_host() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("cookies.sqlite");
        make_cookie_db(
            &db,
            &[
                (".bilibili.com", "SESSDATA", "sess-val"),
                ("bilibili.com", "bili_jct", "jct-val"),
                ("www.example.com", "other", "ignored"),
                ("evilbilibili.com", "lookalike", "ignored"),
            ],
        );

        let mut cookies = HashMap::new();
        let has_any = read_bilibili_cookies(&db, &mut cookies).unwrap();
        assert!(has_any);
        assert_eq!(cookies.len(), 2, "non-bilibili hosts filtered out");
        assert_eq!(cookies.get("SESSDATA").unwrap(), "sess-val");
        assert_eq!(cookies.get("bili_jct").unwrap(), "jct-val");
        assert!(
            !cookies.contains_key("lookalike"),
            "suffix must not match mid-label"
        );
    }

    #[test]
    fn read_bilibili_cookies_empty_db_reports_no_cookies() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("cookies.sqlite");
        make_cookie_db(&db, &[]);

        let mut cookies = HashMap::new();
        assert!(!read_bilibili_cookies(&db, &mut cookies).unwrap());
        assert!(cookies.is_empty());
    }

    #[test]
    fn read_cookie_returns_cached_entries_via_mock_app() {
        use crate::models::cookie::CookieCache;
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(CookieCache::default());
        app.state::<CookieCache>()
            .cookies
            .lock()
            .unwrap()
            .push(CookieEntry {
                host: ".bilibili.com".into(),
                name: "SESSDATA".into(),
                value: "v".into(),
            });

        let cached = read_cookie(app.handle()).unwrap().expect("Some cache");
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "SESSDATA");
    }

    #[test]
    fn read_cookie_without_cache_state_returns_none() {
        // No CookieCache managed: falls through to Ok(None) instead of erroring
        let app = tauri::test::mock_app();
        assert!(read_cookie(app.handle()).unwrap().is_none());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn read_cookie_simulate_logout_returns_empty_list() {
        use crate::models::cookie::{CookieCache, SimulateLogoutFlag};
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(CookieCache::default());
        app.manage(SimulateLogoutFlag::default());
        *app.state::<SimulateLogoutFlag>().enabled.lock().unwrap() = true;

        let cached = read_cookie(app.handle())
            .unwrap()
            .expect("Some(empty) in dev mode");
        assert!(cached.is_empty(), "simulated logout reports no cookies");
    }

    #[test]
    fn tccutil_reset_args_targets_service_and_bundle() {
        assert_eq!(
            tccutil_reset_args("SystemPolicyAppDataDetailed", "com.example.app"),
            ["reset", "SystemPolicyAppDataDetailed", "com.example.app"]
        );
    }

    #[test]
    fn should_reset_firefox_data_grant_runs_until_recorded_and_skips_unreadable_settings() {
        let settings = |reset_done| Settings {
            firefox_permission_reset_done: reset_done,
            ..Settings::default()
        };
        let decide = |reset_done| should_reset_firefox_data_grant(Some(&settings(reset_done)));
        assert!(decide(None));
        assert!(decide(Some(false)));
        assert!(!decide(Some(true)));
        assert!(!should_reset_firefox_data_grant(None));
    }

    #[test]
    fn reset_done_patch_lands_on_the_settings_field() {
        let mut object = serde_json::to_value(Settings::default()).unwrap();
        let patch = firefox_permission_reset_done_patch();
        object
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        let settings: Settings = serde_json::from_value(object).unwrap();
        assert_eq!(settings.firefox_permission_reset_done, Some(true));
    }
}
