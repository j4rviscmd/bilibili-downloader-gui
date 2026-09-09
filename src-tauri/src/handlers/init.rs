//! Backend initialization sequence (consolidated init).
//!
//! Runs on the Rust side so the splash window (a separate webview) can show
//! progress without sharing Redux state with the main window. Emits
//! `init_step` labels for each step; the splash listens and renders them.
//! The final result (settings, user, login_success) is stored in AppHandle
//! State and read by the main window via `get_init_result` on startup, so the
//! main window never re-runs the heavy init.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::handlers::{bilibili, cleanup, cookie, ffmpeg, history_session, qr_login};
use crate::models::frontend_dto::User;
use crate::models::qr_login::{CookieRefreshInfo, LoginMethod};
use crate::models::settings::Settings;

/// Payload for a synchronous init step (label only, no progress bar).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitStep {
    pub label_key: String,
}

/// Payload for an asynchronous init step (label + optional percentage).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitProgress {
    pub label_key: String,
    pub percentage: Option<f64>,
}

/// Result of the backend init sequence, handed off to the main window.
///
/// Stored in AppHandle State (Mutex<InitResult>); the main window reads it via
/// `get_init_result` instead of re-running init.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    pub settings: Option<Settings>,
    pub user: Option<User>,
    /// Error string from user-info fetch (None on success). Handed to the main
    /// window so it can run interceptInvokeError (e.g. session-expiry toast).
    pub user_error: Option<String>,
    /// True when ffmpeg is valid or was successfully installed.
    pub ffmpeg_success: bool,
}

/// Runs the backend initialization sequence, emitting progress events to the
/// "splash" window and storing the result in AppHandle State.
///
/// Mirrors the previous frontend `useInit` orchestration so behavior is
/// preserved (login-method branching, ffmpeg install, user fetch).
#[tauri::command]
pub async fn initialize(app: AppHandle) -> Result<(), String> {
    // Idempotency guard: `initialize` may be invoked from both the splash
    // window (useSplashLifecycle) and the main window (useInit.initApp, used
    // in E2E mode where there is no splash). The AtomicBool guarantees the
    // heavy init (cleanup, ffmpeg, session restore, user fetch) runs at most
    // once per process; the second caller returns immediately.
    let init_guard = app.state::<std::sync::atomic::AtomicBool>();
    if init_guard.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }

    // 1. Clean up orphaned temp files from previous sessions.
    emit_step(&app, "init.cleanup_in_progress");
    let _ = cleanup::cleanup_temp_files(&app, None);
    // Also sweep abandoned *.part.* staging files and orphaned sidecar
    // locks from the download output directory (crashed downloads,
    // issues #560/#595).
    let _ = cleanup::cleanup_part_files(&app).await;
    // Mark in_progress history entries whose owning process is gone as
    // failed (crash recovery, issue #511). Live downloads in another app
    // instance hold their session flock and are never touched.
    let _ = history_session::recover_interrupted(&app);

    // 2. ffmpeg validate / install (heaviest step; downloads on first run).
    //    Settings are already loaded in setup and stored in InitResult, so
    //    they are not reloaded here.
    emit_step(&app, "init.checking_ffmpeg");
    let mut ffmpeg_success = ffmpeg::validate_ffmpeg(&app).await;
    if !ffmpeg_success {
        emit_step(&app, "init.installing_ffmpeg");
        ffmpeg_success = ffmpeg::install_ffmpeg(&app).await.unwrap_or(false);
    }

    // 3. Session restore. Honor the user-selected login method strictly (no
    //    cross-method fallback), mirroring useInit.
    let login_method = qr_login::get_login_method(&app)
        .await
        .unwrap_or(LoginMethod::Firefox);
    match login_method {
        LoginMethod::QrCode => {
            let loaded = qr_login::load_stored_session(&app).await.unwrap_or(false);
            if loaded {
                let refresh_info =
                    qr_login::check_cookie_refresh(&app)
                        .await
                        .unwrap_or(CookieRefreshInfo {
                            refresh: false,
                            timestamp: 0,
                        });
                if !refresh_info.refresh {
                    emit_step(&app, "init.qr_session_restored");
                } else {
                    match qr_login::refresh_cookie(&app).await {
                        Ok(_) => {
                            emit_step(&app, "init.cookie_refreshed");
                        }
                        Err(e) => {
                            // Refresh failed: keep the stale session file for now so
                            // the user can retry without re-scanning on transient
                            // network failures, but do not claim the session was
                            // restored. The subsequent `fetch_user_info` will
                            // return `isLogin=false` for a truly invalid session,
                            // and `SettingsForm` now checks the live user state
                            // (not just file existence) so the UI stays
                            // consistent (both AppBar and Settings show not
                            // logged-in / expired).
                            log::warn!(
                                "[BE] init: cookie refresh failed, keeping stale session for retry: {}",
                                e
                            );
                            emit_step(&app, "init.cookie_failed");
                        }
                    }
                }
            }
        }
        LoginMethod::Firefox => {
            emit_step(&app, "init.reading_cookies");
            let _ = cookie::get_cookie(&app).await;
        }
        LoginMethod::Manual => {
            // Same restore path as QR, but no refresh attempt: a manual
            // paste never carries a refresh_token, so renewal is a re-paste.
            // Reuses the QR restore label since the user-facing meaning
            // ("login session restored") is identical.
            let loaded = qr_login::load_stored_session(&app).await.unwrap_or(false);
            if loaded {
                emit_step(&app, "init.qr_session_restored");
            }
        }
    }

    // 4. User info. Capture the error string (if any) so the main window can
    //    run interceptInvokeError (e.g. session-expiry toast) — mirroring the
    //    previous frontend getUserInfo behavior.
    emit_step(&app, "init.fetching_user");
    let (user, user_error) = match bilibili::fetch_user_info(&app).await {
        Ok(u) => (Some(u), None),
        Err(e) => (None, Some(e)),
    };

    // 5. Store the result for the main window to read on startup.
    if let Some(state) = app.try_state::<Mutex<InitResult>>() {
        if let Ok(mut guard) = state.lock() {
            // guard.settings is set in setup (before the splash is created);
            // do not overwrite it here.
            guard.user = user;
            guard.user_error = user_error;
            guard.ffmpeg_success = ffmpeg_success;
        }
    }

    Ok(())
}

/// Returns the result of the backend init sequence. Called by the main window
/// on startup (after finish_splash) to avoid re-running init.
#[tauri::command]
pub fn get_init_result(state: State<'_, Mutex<InitResult>>) -> InitResult {
    state.lock().map(|g| g.clone()).unwrap_or_default()
}

/// Emits a synchronous init step (label only) to the splash window.
// Why: generic over R — production callers pass AppHandle (= AppHandle<Wry>)
// while tests pass tauri::test::mock_app()'s AppHandle<MockRuntime>
// (tauri "test" dev-dependency feature, src-tauri/Cargo.toml); Emitter<R> is
// the minimal bound covering both.
fn emit_step<R: tauri::Runtime>(app: &impl Emitter<R>, label_key: &str) {
    let _ = app.emit_to(
        "splash",
        "init_step",
        InitStep {
            label_key: label_key.to_string(),
        },
    );
}

/// Emits an asynchronous init step (label + percentage) to the splash window.
#[allow(dead_code)]
fn emit_progress<R: tauri::Runtime>(
    app: &impl Emitter<R>,
    label_key: &str,
    percentage: Option<f64>,
) {
    let _ = app.emit_to(
        "splash",
        "init_progress",
        InitProgress {
            label_key: label_key.to_string(),
            percentage,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_step_serializes_camel_case() {
        let json = serde_json::to_value(InitStep {
            label_key: "init.cleanup_in_progress".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"labelKey": "init.cleanup_in_progress"})
        );
    }

    #[test]
    fn init_progress_serializes_camel_case_with_optional_percentage() {
        let with_pct = serde_json::to_value(InitProgress {
            label_key: "init.x".into(),
            percentage: Some(42.5),
        })
        .unwrap();
        assert_eq!(
            with_pct,
            serde_json::json!({"labelKey": "init.x", "percentage": 42.5})
        );

        let without_pct = serde_json::to_value(InitProgress {
            label_key: "init.x".into(),
            percentage: None,
        })
        .unwrap();
        assert_eq!(
            without_pct,
            serde_json::json!({"labelKey": "init.x", "percentage": null})
        );
    }

    #[test]
    fn init_result_default_is_empty_and_serializes_camel_case() {
        let default = InitResult::default();
        assert!(default.settings.is_none());
        assert!(default.user.is_none());
        assert!(default.user_error.is_none());
        assert!(!default.ffmpeg_success);

        let json = serde_json::to_value(InitResult {
            user_error: Some("ERR::UNAUTHORIZED".into()),
            ffmpeg_success: true,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "settings": null,
                "user": null,
                "userError": "ERR::UNAUTHORIZED",
                "ffmpegSuccess": true
            })
        );
    }

    #[test]
    fn get_init_result_returns_managed_state() {
        // mock_app lets State<T> resolution run without a real window/app;
        // initialize() itself is NOT invoked (it would run the full network
        // init — cleanup/ffmpeg/user fetch — against the mock runtime).
        let app = tauri::test::mock_app();
        let stored = InitResult {
            ffmpeg_success: true,
            ..Default::default()
        };
        app.manage(Mutex::new(stored));

        let state: State<'_, Mutex<InitResult>> = app.state();
        let result = get_init_result(state);
        assert!(result.ffmpeg_success);
        assert!(result.user.is_none());
    }

    #[test]
    fn emit_step_to_missing_splash_window_is_swallowed() {
        // The mock app has no "splash" window, so emit_to errors; emit_step
        // must swallow it instead of panicking.
        let app = tauri::test::mock_app();
        emit_step(app.handle(), "init.cleanup_in_progress");
    }
}
