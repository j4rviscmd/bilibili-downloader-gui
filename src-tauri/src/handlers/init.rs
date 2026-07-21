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

use crate::handlers::{bilibili, cleanup, cookie, ffmpeg, qr_login};
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
                        Err(_) => {
                            // Refresh failed: clear the stale session, stay logged out.
                            let _ = qr_login::logout(&app).await;
                        }
                    }
                }
            }
        }
        LoginMethod::Firefox => {
            emit_step(&app, "init.reading_cookies");
            let _ = cookie::get_cookie(&app).await;
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
fn emit_step(app: &AppHandle, label_key: &str) {
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
fn emit_progress(app: &AppHandle, label_key: &str, percentage: Option<f64>) {
    let _ = app.emit_to(
        "splash",
        "init_progress",
        InitProgress {
            label_key: label_key.to_string(),
            percentage,
        },
    );
}
