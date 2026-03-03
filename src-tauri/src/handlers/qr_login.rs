//! QR Code Login Handler
//!
//! This module handles Bilibili QR code authentication flow:
//! 1. Generate QR code image
//! 2. Poll for login status
//! 3. Store session on success
//! 4. Logout (clear session)

use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::Luma;
use qrcode::QrCode;
use reqwest::Client;
use reqwest::Url;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;
use crate::models::qr_login::{
    LoginMethod, LoginState, QrCodeGenerateResponse, QrCodePollResponse, QrCodeResult,
    QrCodeStatus, QrPollResult, QrSession,
};

const QR_GENERATE_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const STORE_FILE_NAME: &str = "login_state.json";
const LOGIN_STATE_KEY: &str = "loginState";

/// Generates a QR code for Bilibili login.
///
/// This function:
/// 1. Calls Bilibili's QR generate API
/// 2. Creates a QR code image from the URL
/// 3. Returns base64-encoded image and polling key
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns `QrCodeResult` with base64 image and polling key.
///
/// # Errors
///
/// Returns an error if:
/// - API request fails
/// - QR code generation fails
pub async fn generate_qr_code(_app: &AppHandle) -> Result<QrCodeResult, String> {
    let client = Client::new();

    // Call Bilibili QR generate API
    let response = client
        .get(QR_GENERATE_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to request QR code: {}", e))?;

    let qr_response: QrCodeGenerateResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse QR response: {}", e))?;

    if qr_response.code != 0 {
        return Err(format!("QR generate API error: {}", qr_response.message));
    }

    let data = qr_response
        .data
        .ok_or_else(|| "No data in QR response".to_string())?;

    // Generate QR code image
    let code = QrCode::new(&data.url).map_err(|e| format!("Failed to generate QR code: {}", e))?;

    // Convert to PNG image
    let image = code.render::<Luma<u8>>().build();

    // Encode to PNG format
    let mut png_data = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_data);
        image
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    }

    // Convert to base64
    let base64_image = STANDARD.encode(&png_data);
    let data_url = format!("data:image/png;base64,{}", base64_image);

    Ok(QrCodeResult {
        qr_code_image: data_url,
        qrcode_key: data.qrcode_key,
    })
}

/// Polls the QR code login status.
///
/// This function checks if the user has scanned the QR code and confirmed login.
/// on success, it extracts cookies and stores the session.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `qrcode_key` - The key from QR code generation
///
/// # Returns
///
/// Returns `QrPollResult` with status and session data (on success).
///
/// # Errors
///
/// Returns an error if:
/// - API request fails
/// - Response parsing fails
pub async fn poll_qr_status(app: &AppHandle, qrcode_key: &str) -> Result<QrPollResult, String> {
    let client = Client::new();

    // Call Bilibili QR poll API
    let url = format!("{}?qrcode_key={}", QR_POLL_URL, qrcode_key);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to poll QR status: {}", e))?;

    let poll_response: QrCodePollResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse poll response: {}", e))?;

    if poll_response.code != 0 {
        return Err(format!("Poll API error: {}", poll_response.message));
    }

    let data = poll_response
        .data
        .ok_or_else(|| "No data in poll response".to_string())?;

    let status = QrCodeStatus::from(data.status_code);

    // On success, extract cookies and store session
    if status == QrCodeStatus::Success {
        let session = extract_session_from_url(&data.url, &data.refresh_token, data.timestamp)?;

        // Store session to persistent storage
        save_session(app, &session).await?;

        // Also update the in-memory cookie cache for immediate use
        update_cookie_cache(app, &session);
    }

    Ok(QrPollResult {
        status: status.clone(),
        message: data.message,
        session: None, // Don't expose session to frontend, it's stored internally
    })
}

/// Extracts session data from the login URL.
///
/// The URL contains query parameters with cookie values.
fn extract_session_from_url(
    url: &str,
    refresh_token: &str,
    timestamp: i64,
) -> Result<QrSession, String> {
    // Parse URL and extract query parameters
    let parsed_url = Url::parse(url).map_err(|e| format!("Failed to parse login URL: {}", e))?;

    let query_pairs: std::collections::HashMap<String, String> = parsed_url
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    Ok(QrSession {
        sessdata: query_pairs.get("SESSDATA").cloned().unwrap_or_default(),
        bili_jct: query_pairs.get("bili_jct").cloned().unwrap_or_default(),
        dede_user_id: query_pairs.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id__ck_md5: query_pairs
            .get("DedeUserID__ckMd5")
            .cloned()
            .unwrap_or_default(),
        refresh_token: refresh_token.to_string(),
        timestamp,
    })
}

/// Saves the session to persistent storage.
async fn save_session(app: &AppHandle, session: &QrSession) -> Result<(), String> {
    let store = app
        .store(STORE_FILE_NAME)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let login_state = LoginState {
        method: LoginMethod::QrCode,
        qr_session: Some(session.clone()),
    };

    store.set(
        LOGIN_STATE_KEY,
        serde_json::to_value(&login_state)
            .map_err(|e| format!("Failed to serialize login state: {}", e))?,
    );

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

/// Updates the in-memory cookie cache with QR session cookies.
fn update_cookie_cache(app: &AppHandle, session: &QrSession) {
    let Some(cache) = app.try_state::<CookieCache>() else {
        return;
    };
    let Ok(mut guard) = cache.cookies.lock() else {
        return;
    };

    *guard = vec![
        CookieEntry {
            host: ".bilibili.com".to_string(),
            name: "SESSDATA".to_string(),
            value: session.sessdata.clone(),
        },
        CookieEntry {
            host: ".bilibili.com".to_string(),
            name: "bili_jct".to_string(),
            value: session.bili_jct.clone(),
        },
        CookieEntry {
            host: ".bilibili.com".to_string(),
            name: "DedeUserID".to_string(),
            value: session.dede_user_id.clone(),
        },
        CookieEntry {
            host: ".bilibili.com".to_string(),
            name: "DedeUserID__ckMd5".to_string(),
            value: session.dede_user_id__ck_md5.clone(),
        },
    ];
}

/// Loads the stored session and updates cookie cache.
///
/// This should be called on app startup to restore login state.
///
/// # Returns
///
/// Returns `Ok(true)` if a QR session was restored, `Ok(false)` if no session exists.
pub async fn load_stored_session(app: &AppHandle) -> Result<bool, String> {
    let store = match app.store(STORE_FILE_NAME) {
        Ok(s) => s,
        Err(_) => return Ok(false), // Store doesn't exist yet
    };

    let value = match store.get(LOGIN_STATE_KEY) {
        Some(v) => v,
        None => return Ok(false),
    };

    let login_state: LoginState = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to deserialize login state: {}", e))?;

    // Only restore QR session if that's the preferred method
    if login_state.method == LoginMethod::QrCode {
        if let Some(session) = &login_state.qr_session {
            update_cookie_cache(app, session);
            return Ok(true);
        }
    }

    Ok(false)
}

/// Logs out by clearing the stored session and cookie cache.
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns `Ok(())` on success.
pub async fn logout(app: &AppHandle) -> Result<(), String> {
    // Clear cookie cache
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(mut guard) = cache.cookies.lock() {
            guard.clear();
        }
    }

    // Clear stored session
    let store = app
        .store(STORE_FILE_NAME)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set(
        LOGIN_STATE_KEY,
        serde_json::to_value(&LoginState::default())
            .map_err(|e| format!("Failed to serialize login state: {}", e))?,
    );

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

/// Sets the preferred login method.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `method` - The login method to use
///
/// # Returns
///
/// Returns `Ok(())` on success.
pub async fn set_login_method(app: &AppHandle, method: LoginMethod) -> Result<(), String> {
    let store = app
        .store(STORE_FILE_NAME)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let existing_state: LoginState = store
        .get(LOGIN_STATE_KEY)
        .map(|v| serde_json::from_value(v.clone()).unwrap_or_default())
        .unwrap_or_default();

    let login_state = LoginState {
        method,
        qr_session: existing_state.qr_session,
    };

    store.set(
        LOGIN_STATE_KEY,
        serde_json::to_value(&login_state)
            .map_err(|e| format!("Failed to serialize login state: {}", e))?,
    );

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

/// Gets the current login method preference.
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns the current login method.
pub async fn get_login_method(app: &AppHandle) -> Result<LoginMethod, String> {
    let store = match app.store(STORE_FILE_NAME) {
        Ok(s) => s,
        Err(_) => return Ok(LoginMethod::default()),
    };

    let value = match store.get(LOGIN_STATE_KEY) {
        Some(v) => v,
        None => return Ok(LoginMethod::default()),
    };

    let login_state: LoginState = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to deserialize login state: {}", e))?;

    Ok(login_state.method)
}

/// Gets the current login state.
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns the current login state.
pub async fn get_login_state(app: &AppHandle) -> Result<LoginState, String> {
    let store = match app.store(STORE_FILE_NAME) {
        Ok(s) => s,
        Err(_) => return Ok(LoginState::default()),
    };

    let value = match store.get(LOGIN_STATE_KEY) {
        Some(v) => v,
        None => return Ok(LoginState::default()),
    };

    let login_state: LoginState = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to deserialize login state: {}", e))?;

    Ok(login_state)
}
