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
    ConfirmRefreshResponse, CookieRefreshData, CookieRefreshInfo, CookieRefreshInfoResponse,
    CookieRefreshResponse, LoginMethod, LoginState, QrCodeGenerateResponse, QrCodePollResponse,
    QrCodeResult, QrCodeStatus, QrPollResult, QrSession,
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

// =============================================================================
// Cookie Refresh API
// =============================================================================

const COOKIE_INFO_URL: &str = "https://passport.bilibili.com/x/passport-login/web/cookie/info";
const COOKIE_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
const CONFIRM_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
const CORRESPOND_URL_PREFIX: &str = "https://www.bilibili.com/correspond/1/";

/// RSA public key for CorrespondPath generation (JWK format)
const RSA_PUBLIC_KEY_N: &str = "y4HdjgJHBlbaBN04VERG4qNBIFHP6a3GozCl75AihQloSWCXC5HDNgyinEnhaQ_4-gaMud_GF50elYXLlCToR9se9Z8z433U3KjM-3Yx7ptKkmQNAMggQwAVKgq3zYAoidNEWuxpkY_mAitTSRLnsJW-NCTa0bqBFF6Wm1MxgfE";
const RSA_PUBLIC_KEY_E: &str = "AQAB";

/// Checks if cookie refresh is needed.
///
/// Calls Bilibili's cookie info API to determine if the current session
/// needs to be refreshed.
///
/// # Returns
///
/// Returns `CookieRefreshInfo` with `refresh` flag indicating if refresh is needed.
pub async fn check_cookie_refresh(app: &AppHandle) -> Result<CookieRefreshInfo, String> {
    let cookies = get_cookie_header(app);

    let client = Client::new();
    let response = client
        .get(COOKIE_INFO_URL)
        .header("Cookie", &cookies)
        .send()
        .await
        .map_err(|e| format!("Failed to check cookie refresh: {}", e))?;

    let info_response: CookieRefreshInfoResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse cookie info response: {}", e))?;

    match info_response.code {
        0 => info_response
            .data
            .ok_or_else(|| "No data in cookie info response".to_string()),
        -101 => Ok(CookieRefreshInfo {
            refresh: false,
            timestamp: 0,
        }),
        _ => Err(format!("Cookie info API error: {}", info_response.message)),
    }
}

/// Generates CorrespondPath using RSA-OAEP encryption.
///
/// The path is generated by encrypting `refresh_{timestamp}` with Bilibili's public key.
fn generate_correspond_path(timestamp: i64) -> Result<String, String> {
    use base16ct::lower::encode_string;
    use rsa::{pkcs8::DecodePublicKey, Oaep};
    use sha2::Sha256;

    // Construct PEM format public key
    let public_key_pem = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n{}\n-----END PUBLIC KEY-----",
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg",
        "Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40JNrRuoEUXpabUzGB8QIDAQAB"
    );

    let public_key = rsa::RsaPublicKey::from_public_key_pem(&public_key_pem)
        .map_err(|e| format!("Failed to parse public key: {}", e))?;

    let message = format!("refresh_{}", timestamp);
    let padding = Oaep::new::<Sha256>();

    let encrypted = public_key
        .encrypt(&mut rand::thread_rng(), padding, message.as_bytes())
        .map_err(|e| format!("Failed to encrypt: {}", e))?;

    Ok(encode_string(&encrypted))
}

/// Fetches refresh_csrf from Bilibili's correspond endpoint.
///
/// The HTML response contains a div with id '1-name' containing the refresh_csrf token.
async fn fetch_refresh_csrf(app: &AppHandle, correspond_path: &str) -> Result<String, String> {
    let cookies = get_cookie_header(app);
    let url = format!("{}{}", CORRESPOND_URL_PREFIX, correspond_path);

    let client = Client::new();
    let response = client
        .get(&url)
        .header("Cookie", &cookies)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch refresh_csrf: {}", e))?;

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse refresh_csrf from HTML: <div id="1-name">{refresh_csrf}</div>
    let start_tag = r#"<div id="1-name">"#;
    let end_tag = "</div>";

    let start = html
        .find(start_tag)
        .ok_or_else(|| "Could not find 1-name div in response".to_string())?
        + start_tag.len();
    let end = html[start..]
        .find(end_tag)
        .ok_or_else(|| "Could not find closing div tag".to_string())?
        + start;

    Ok(html[start..end].to_string())
}

/// Refreshes the cookie using the stored refresh_token.
///
/// This function:
/// 1. Checks if refresh is needed
/// 2. Generates CorrespondPath
/// 3. Fetches refresh_csrf
/// 4. Calls cookie refresh API
/// 5. Confirms the refresh
/// 6. Updates stored session with new cookies and refresh_token
///
/// # Returns
///
/// Returns the new session data on success.
pub async fn refresh_cookie(app: &AppHandle) -> Result<QrSession, String> {
    // Step 1: Check if refresh is needed
    let refresh_info = check_cookie_refresh(app).await?;
    if !refresh_info.refresh {
        return Err("Cookie refresh not needed".to_string());
    }

    // Get current session for refresh_token and csrf
    let login_state = get_login_state(app).await?;
    let session = login_state
        .qr_session
        .ok_or_else(|| "No QR session found".to_string())?;

    // Step 2: Generate CorrespondPath
    let correspond_path = generate_correspond_path(refresh_info.timestamp)?;

    // Step 3: Fetch refresh_csrf
    let refresh_csrf = fetch_refresh_csrf(app, &correspond_path).await?;

    // Step 4: Call cookie refresh API
    let cookies = get_cookie_header(app);
    let client = Client::new();

    let params = [
        ("csrf", session.bili_jct.clone()),
        ("refresh_csrf", refresh_csrf),
        ("source", "main_web".to_string()),
        ("refresh_token", session.refresh_token.clone()),
    ];

    let response = client
        .post(COOKIE_REFRESH_URL)
        .header("Cookie", &cookies)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh cookie: {}", e))?;

    // Extract new cookies from Set-Cookie headers
    let new_cookies = extract_cookies_from_response(&response);

    let refresh_response: CookieRefreshResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    if refresh_response.code != 0 {
        return Err(format!(
            "Cookie refresh API error: {}",
            refresh_response.message
        ));
    }

    let new_refresh_token = refresh_response
        .data
        .map(|d| d.refresh_token)
        .ok_or_else(|| "No refresh_token in response".to_string())?;

    // Step 5: Confirm refresh (invalidate old refresh_token)
    let new_cookies_header = build_cookie_header(&new_cookies);
    let confirm_params = [
        (
            "csrf",
            new_cookies.get("bili_jct").cloned().unwrap_or_default(),
        ),
        ("refresh_token", session.refresh_token.clone()),
    ];

    let _confirm_response: ConfirmRefreshResponse = client
        .post(CONFIRM_REFRESH_URL)
        .header("Cookie", &new_cookies_header)
        .form(&confirm_params)
        .send()
        .await
        .map_err(|e| format!("Failed to confirm refresh: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse confirm response: {}", e))?;

    // Step 6: Build new session and save
    let new_session = QrSession {
        sessdata: new_cookies.get("SESSDATA").cloned().unwrap_or_default(),
        bili_jct: new_cookies.get("bili_jct").cloned().unwrap_or_default(),
        dede_user_id: new_cookies.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id__ck_md5: new_cookies
            .get("DedeUserID__ckMd5")
            .cloned()
            .unwrap_or_default(),
        refresh_token: new_refresh_token,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    // Update cookie cache
    update_cookie_cache(app, &new_session);

    // Save new session
    save_session(app, &new_session).await?;

    Ok(new_session)
}

/// Gets the Cookie header value from the cache.
fn get_cookie_header(app: &AppHandle) -> String {
    let Some(cache) = app.try_state::<CookieCache>() else {
        return String::new();
    };
    let Ok(guard) = cache.cookies.lock() else {
        return String::new();
    };

    guard
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Extracts cookies from Set-Cookie headers.
fn extract_cookies_from_response(
    response: &reqwest::Response,
) -> std::collections::HashMap<String, String> {
    let mut cookies = std::collections::HashMap::new();

    for cookie in response.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie_str) = cookie.to_str() {
            // Parse "name=value; Path=/; ..."
            if let Some(cookie_part) = cookie_str.split(';').next() {
                if let Some((name, value)) = cookie_part.split_once('=') {
                    cookies.insert(name.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }

    cookies
}

/// Builds a Cookie header from a HashMap.
fn build_cookie_header(cookies: &std::collections::HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ")
}
