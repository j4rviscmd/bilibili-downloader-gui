//! QR Code Login Handler
//!
//! This module handles Bilibili QR code authentication flow:
//! 1. Generate QR code image
//! 2. Poll for login status
//! 3. Store session securely in OS keyring on success
//! 4. Logout (clear session from keyring)
//!
//! # Security
//!
//! Session tokens (SESSDATA, refresh_token, etc.) are stored in the OS's
//! secure credential storage:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (gnome-keyring, KWallet, etc.)
//!
//! The tauri-plugin-store is only used for non-sensitive settings
//! like the preferred login method.

use std::io::Cursor;
use std::sync::RwLock;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::Luma;
use qrcode::QrCode;
use reqwest::Client;
use reqwest::Url;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::constants;
use crate::handlers::bilibili::fetch_user_info;
use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;
use crate::models::qr_login::{
    BuvidResponse, ConfirmRefreshResponse, CookieRefreshInfo, CookieRefreshInfoResponse,
    CookieRefreshResponse, LoginMethod, LoginState, QrCodeGenerateResponse, QrCodePollResponse,
    QrCodeResult, QrCodeStatus, QrPollResult, Session,
};

const QR_GENERATE_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const STORE_FILE_NAME: &str = "login_state.json";
const LOGIN_STATE_KEY: &str = "loginState";

// Keyring configuration
const KEYRING_SERVICE: &str = "com.j4rviscmd.bilibili-downloader-gui";
const KEYRING_SESSION_KEY: &str = "session";

// Session cache to avoid multiple keyring access dialogs
// None = not initialized yet, Some(None) = no session, Some(Some(session)) = session exists
static SESSION_CACHE: RwLock<Option<Option<Session>>> = RwLock::new(None);

/// Returns true if running in E2E test mode (bypasses OS keyring).
pub fn is_e2e_testing() -> bool {
    std::env::var("E2E_TESTING")
        .map(|v| v == "true")
        .unwrap_or(false)
}

// Keyring Helper Functions

/// Creates a keyring entry for the session credential.
///
/// # Errors
///
/// Returns an error if the keyring entry cannot be created.
fn create_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_SESSION_KEY)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))
}

/// Creates a bilibili cookie entry with the standard host.
fn bilibili_cookie(name: &str, value: String) -> CookieEntry {
    CookieEntry {
        host: ".bilibili.com".to_string(),
        name: name.to_string(),
        value,
    }
}

/// Saves session to OS keyring.
///
/// # Errors
///
/// Returns an error if:
/// - Keyring is not available (e.g., no Secret Service on Linux)
/// - Failed to store the credential
fn save_session_to_keyring(session: &Session) -> Result<(), String> {
    if is_e2e_testing() {
        log::info!("[BE] save_session_to_keyring: skipped (E2E_TESTING)");
        return Ok(());
    }
    log::info!("[BE] save_session_to_keyring: saving session to keyring");
    let entry = create_keyring_entry()?;

    let session_json = serde_json::to_string(session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;

    entry
        .set_password(&session_json)
        .map_err(|e| format!("Failed to store session in keyring: {}", e))?;

    // Update cache
    {
        let mut cache = SESSION_CACHE
            .write()
            .map_err(|e| format!("Failed to write cache: {}", e))?;
        *cache = Some(Some(session.clone()));
    }

    log::info!(
        "[BE] save_session_to_keyring: session saved successfully ({} bytes)",
        session_json.len()
    );
    Ok(())
}

/// Loads session from OS keyring with caching.
///
/// Uses an in-memory cache to avoid multiple keyring access dialogs.
/// On first call, reads from keyring and caches the result.
/// Subsequent calls return the cached value.
///
/// # Returns
///
/// Returns `Ok(Some(session))` if session exists, `Ok(None)` if not found.
///
/// # Errors
///
/// Returns an error if:
/// - Keyring is not available
/// - Failed to retrieve the credential
fn load_session_from_keyring() -> Result<Option<Session>, String> {
    if is_e2e_testing() {
        log::info!("[BE] load_session_from_keyring: skipped (E2E_TESTING)");
        return Ok(None);
    }
    log::info!("[BE] load_session_from_keyring: loading session from keyring");
    // Check cache first
    {
        let cache = SESSION_CACHE
            .read()
            .map_err(|e| format!("Failed to read cache: {}", e))?;
        if let Some(cached) = cache.as_ref() {
            log::info!("[BE] load_session_from_keyring: returning cached session");
            return Ok(cached.clone());
        }
    }

    // Not cached, read from keyring
    let entry = create_keyring_entry().map_err(|e| {
        log::error!("[BE] load_session_from_keyring: {}", e);
        e
    })?;

    let result = match entry.get_password() {
        Ok(json) => {
            let session: Session = serde_json::from_str(&json)
                .map_err(|e| format!("Failed to deserialize session: {}", e))?;
            log::info!("[BE] load_session_from_keyring: session loaded successfully");
            Ok(Some(session))
        }
        Err(keyring::Error::NoEntry) => {
            log::info!("[BE] load_session_from_keyring: no session found");
            Ok(None)
        }
        Err(e) => {
            log::error!(
                "[BE] load_session_from_keyring: failed to get password: {}",
                e
            );
            Err(format!("Failed to retrieve session from keyring: {}", e))
        }
    };

    // Cache the result
    if let Ok(ref session) = result {
        let mut cache = SESSION_CACHE
            .write()
            .map_err(|e| format!("Failed to write cache: {}", e))?;
        *cache = Some(session.clone());
    }

    result
}

/// Deletes session from OS keyring and clears cache.
///
/// # Errors
///
/// Returns an error if deletion fails (ignores "no entry" error).
fn delete_session_from_keyring() -> Result<(), String> {
    if is_e2e_testing() {
        log::info!("[BE] delete_session_from_keyring: skipped (E2E_TESTING)");
        return Ok(());
    }
    log::info!("[BE] delete_session_from_keyring: deleting session from keyring");
    // Clear cache first
    {
        let mut cache = SESSION_CACHE
            .write()
            .map_err(|e| format!("Failed to write cache: {}", e))?;
        *cache = None;
    }

    let entry = create_keyring_entry().map_err(|e| {
        log::error!("[BE] delete_session_from_keyring: {}", e);
        e
    })?;

    match entry.delete_credential() {
        Ok(()) => {
            log::info!("[BE] delete_session_from_keyring: session deleted successfully");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            log::info!("[BE] delete_session_from_keyring: no session to delete");
            Ok(())
        }
        Err(e) => {
            log::error!("[BE] delete_session_from_keyring: failed to delete: {}", e);
            Err(format!("Failed to delete session from keyring: {}", e))
        }
    }
}

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
    log::info!("[BE] generate_qr_code: generating QR code");
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
    log::debug!(
        "[BE] poll_qr_status: polling with qrcode_key={}",
        qrcode_key
    );
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
        let mut session = extract_session_from_url(&data.url, &data.refresh_token, data.timestamp)?;

        // Fetch buvid3/buvid4 for WBI authentication
        match fetch_buvid().await {
            Ok((buvid3, buvid4)) => {
                session.buvid3 = buvid3;
                session.buvid4 = buvid4;
                log::info!("[BE] poll_qr_status: successfully fetched buvid3/buvid4 for WBI auth");
            }
            Err(e) => {
                log::warn!("[BE] poll_qr_status: failed to fetch buvid3/buvid4: {}", e);
                // Continue without buvid - may cause 412 errors on some videos
            }
        }

        // Also update the in-memory cookie cache for immediate use
        update_cookie_cache(app, &session);

        // Fetch username from user info API
        match fetch_user_info(app).await {
            Ok(user) => {
                if let Some(uname) = user.data.uname {
                    session.uname = uname;
                }
            }
            Err(e) => {
                log::debug!("[BE] Failed to fetch user info: {}", e);
                // Continue without uname - not critical
            }
        }

        // Store session to persistent storage
        save_session(app, &session).await?;
    }

    Ok(QrPollResult {
        status: status.clone(),
        message: data.message,
        session: None, // Don't expose session to frontend, it's stored internally
    })
}

/// Fetches buvid3 and buvid4 from Bilibili API.
///
/// These device IDs are required for WBI authentication to work properly.
/// Without them, some API endpoints may return 412 errors.
///
/// # Returns
///
/// Returns `Ok((buvid3, buvid4))` on success.
///
/// # Errors
///
/// Returns an error if the API request fails or returns invalid data.
async fn fetch_buvid() -> Result<(String, String), String> {
    log::info!("[BE] fetch_buvid: fetching buvid3/buvid4 from API");
    let client = Client::new();

    let response = client
        .get("https://api.bilibili.com/x/frontend/finger/spi")
        .header(reqwest::header::USER_AGENT, constants::USER_AGENT)
        .header(reqwest::header::REFERER, constants::REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch buvid: {}", e))?;

    let buvid_response: BuvidResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse buvid response: {}", e))?;

    if buvid_response.code != 0 {
        return Err(format!("Buvid API error: {}", buvid_response.message));
    }

    let data = buvid_response
        .data
        .ok_or_else(|| "No data in buvid response".to_string())?;

    log::info!(
        "[BE] fetch_buvid: successfully retrieved buvid3 ({} bytes), buvid4 ({} bytes)",
        data.b_3.len(),
        data.b_4.len()
    );

    Ok((data.b_3, data.b_4))
}

/// Extracts session data from the login URL.
///
/// The URL contains query parameters with cookie values.
fn extract_session_from_url(
    url: &str,
    refresh_token: &str,
    timestamp: i64,
) -> Result<Session, String> {
    // Parse URL and extract query parameters
    let parsed_url = Url::parse(url).map_err(|e| format!("Failed to parse login URL: {}", e))?;

    let query_pairs: std::collections::HashMap<String, String> = parsed_url
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    Ok(Session {
        sessdata: query_pairs.get("SESSDATA").cloned().unwrap_or_default(),
        bili_jct: query_pairs.get("bili_jct").cloned().unwrap_or_default(),
        dede_user_id: query_pairs.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id_ck_md5: query_pairs
            .get("DedeUserID__ckMd5")
            .cloned()
            .unwrap_or_default(),
        refresh_token: refresh_token.to_string(),
        timestamp,
        uname: String::new(),
        buvid3: String::new(),
        buvid4: String::new(),
    })
}

/// Saves the session to OS keyring and login method to store.
///
/// The session tokens are stored securely in the OS's credential storage,
/// while only the login method preference is stored in the regular store.
async fn save_session(app: &AppHandle, session: &Session) -> Result<(), String> {
    // Save session to keyring (secure storage)
    save_session_to_keyring(session)?;

    // Save only the login method to store (non-sensitive)
    let store = app
        .store(STORE_FILE_NAME)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let login_state = LoginState {
        method: LoginMethod::QrCode,
        session: None, // Don't store session in store
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
fn update_cookie_cache(app: &AppHandle, session: &Session) {
    let Some(cache) = app.try_state::<CookieCache>() else {
        return;
    };
    let Ok(mut guard) = cache.cookies.lock() else {
        return;
    };

    let mut cookies = vec![
        bilibili_cookie("SESSDATA", session.sessdata.clone()),
        bilibili_cookie("bili_jct", session.bili_jct.clone()),
        bilibili_cookie("DedeUserID", session.dede_user_id.clone()),
        bilibili_cookie("DedeUserID__ckMd5", session.dede_user_id_ck_md5.clone()),
    ];

    // Add buvid3 and buvid4 if available (required for WBI authentication)
    if !session.buvid3.is_empty() {
        cookies.push(bilibili_cookie("buvid3", session.buvid3.clone()));
    }
    if !session.buvid4.is_empty() {
        cookies.push(bilibili_cookie("buvid4", session.buvid4.clone()));
    }

    *guard = cookies;
}

/// Loads the stored session from keyring and updates cookie cache.
///
/// This should be called on app startup to restore login state.
///
/// # Returns
///
/// Returns `Ok(true)` if a QR session was restored, `Ok(false)` if no session exists.
///
/// # Errors
///
/// Returns an error if keyring is not available (e.g., no Secret Service on Linux).
pub async fn load_stored_session(app: &AppHandle) -> Result<bool, String> {
    // Check login method preference
    let login_state = get_login_state_from_store(app).await?;

    if login_state.method != LoginMethod::QrCode {
        return Ok(false);
    }

    // Load session from keyring
    let session = load_session_from_keyring()?;

    if let Some(session) = session {
        log::info!(
            "[BE] load_stored_session: loaded session with buvid3={} bytes, buvid4={} bytes",
            session.buvid3.len(),
            session.buvid4.len()
        );
        update_cookie_cache(app, &session);
        return Ok(true);
    }

    Ok(false)
}

/// Logs out by clearing the stored session from keyring and cookie cache.
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

    // Delete session from keyring
    delete_session_from_keyring()?;

    // Clear login method from store
    let store = app
        .store(STORE_FILE_NAME)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set(
        LOGIN_STATE_KEY,
        serde_json::to_value(LoginState::default())
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

    // Only store the method, not the session (session is in keyring)
    let login_state = LoginState {
        method,
        session: None,
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
    Ok(get_login_state_from_store(app).await?.method)
}

/// Gets the current login state from store (method only, no session).
///
/// Session data is loaded from keyring separately.
async fn get_login_state_from_store(app: &AppHandle) -> Result<LoginState, String> {
    let store = match app.store(STORE_FILE_NAME) {
        Ok(s) => s,
        Err(_) => return Ok(LoginState::default()),
    };

    let value = match store.get(LOGIN_STATE_KEY) {
        Some(v) => v,
        None => return Ok(LoginState::default()),
    };

    let mut state: LoginState = serde_json::from_value(value.clone())
        .map_err(|e| format!("Failed to deserialize login state: {}", e))?;

    // Session is not stored in the store anymore, clear it if present from old data
    state.session = None;

    Ok(state)
}

/// Gets the current login state including session from keyring.
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns the current login state with session (if available from keyring).
///
/// # Errors
///
/// Returns an error if keyring is not available.
pub async fn get_login_state(app: &AppHandle) -> Result<LoginState, String> {
    let store_state = get_login_state_from_store(app).await?;

    // Load session from keyring if using QR code method
    let session = if store_state.method == LoginMethod::QrCode {
        load_session_from_keyring()?
    } else {
        None
    };

    Ok(LoginState {
        method: store_state.method,
        session,
    })
}

// Cookie Refresh API

const COOKIE_INFO_URL: &str = "https://passport.bilibili.com/x/passport-login/web/cookie/info";
const COOKIE_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
const CONFIRM_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
const CORRESPOND_URL_PREFIX: &str = "https://www.bilibili.com/correspond/1/";

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
    log::debug!("[BE] Checking with cookies: {} bytes", cookies.len());

    let client = Client::new();
    let response = client
        .get(COOKIE_INFO_URL)
        .header("Cookie", &cookies)
        .send()
        .await
        .map_err(|e| format!("Failed to check cookie refresh: {}", e))?;

    log::debug!("[BE] API response status: {}", response.status());

    let info_response: CookieRefreshInfoResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse cookie info response: {}", e))?;

    log::debug!(
        "[BE] Response code: {}, refresh: {:?}",
        info_response.code,
        info_response.data.as_ref().map(|d| d.refresh)
    );

    match info_response.code {
        0 => info_response
            .data
            .ok_or_else(|| "No data in cookie info response".to_string()),
        -101 => {
            log::debug!("[BE] Session expired (code: -101)");
            Ok(CookieRefreshInfo {
                refresh: false,
                timestamp: 0,
            })
        }
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

    // Bilibili's RSA public key in PEM format (64-char line wrapping per RFC 7468)
    // Source: Bilibili passport web login page
    let public_key_pem = concat!(
        "-----BEGIN PUBLIC KEY-----\n",
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg\n",
        "Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71\n",
        "nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40\n",
        "JNrRuoEUXpabUzGB8QIDAQAB\n",
        "-----END PUBLIC KEY-----\n"
    );

    let public_key = rsa::RsaPublicKey::from_public_key_pem(public_key_pem)
        .map_err(|e| format!("Failed to parse public key: {}", e))?;

    let message = format!("refresh_{}", timestamp);
    log::debug!("[BE] Encrypting message: {}", message);

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
    log::debug!("[BE] fetch_refresh_csrf: Starting...");
    let cookies = get_cookie_header(app);
    let url = format!("{}{}", CORRESPOND_URL_PREFIX, correspond_path);
    log::debug!("[BE] fetch_refresh_csrf: URL: {}", url);

    let client = Client::builder()
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    log::debug!("[BE] fetch_refresh_csrf: Sending request...");
    let response = client
        .get(&url)
        .header("Cookie", &cookies)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        .header("Accept-Encoding", "identity")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| {
            log::debug!("[BE] fetch_refresh_csrf: Request failed: {}", e);
            format!("Failed to fetch refresh_csrf: {}", e)
        })?;

    log::debug!(
        "[BE] fetch_refresh_csrf: Response status: {}",
        response.status()
    );

    let html = response.text().await.map_err(|e| {
        log::debug!("[BE] fetch_refresh_csrf: Failed to read body: {}", e);
        format!("Failed to read response: {}", e)
    })?;

    log::debug!("[BE] fetch_refresh_csrf: HTML length: {} bytes", html.len());
    log::debug!("[BE] fetch_refresh_csrf: HTML content: {}", html);

    // Parse refresh_csrf from HTML: <div id="1-name">{refresh_csrf}</div>
    let start_tag = r#"<div id="1-name">"#;
    let end_tag = "</div>";

    let start = html.find(start_tag).ok_or_else(|| {
        log::debug!("[BE] fetch_refresh_csrf: Could not find start tag");
        "Could not find 1-name div in response".to_string()
    })? + start_tag.len();
    let end = html[start..].find(end_tag).ok_or_else(|| {
        log::debug!("[BE] fetch_refresh_csrf: Could not find end tag");
        "Could not find closing div tag".to_string()
    })? + start;

    let refresh_csrf = &html[start..end];
    log::debug!(
        "[BE] fetch_refresh_csrf: Found token: {} bytes",
        refresh_csrf.len()
    );
    Ok(refresh_csrf.to_string())
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
pub async fn refresh_cookie(app: &AppHandle) -> Result<Session, String> {
    log::debug!("[BE] Starting cookie refresh process...");

    // Step 1: Check if refresh is needed
    let refresh_info = check_cookie_refresh(app).await?;
    if !refresh_info.refresh {
        log::debug!("[BE] Refresh not needed, aborting");
        return Err("Cookie refresh not needed".to_string());
    }

    log::debug!("[BE] Refresh needed, timestamp: {}", refresh_info.timestamp);

    // Get current session for refresh_token and csrf
    let login_state = get_login_state(app).await.map_err(|e| {
        log::debug!("[BE] ERROR getting login state: {}", e);
        e
    })?;
    let session = login_state.session.ok_or_else(|| {
        log::debug!("[BE] ERROR: No QR session found in login state");
        "No QR session found".to_string()
    })?;

    log::debug!(
        "[BE] Found session: sessdata={} bytes, refresh_token={} bytes",
        session.sessdata.len(),
        session.refresh_token.len()
    );

    // Step 2: Generate CorrespondPath
    let correspond_path = generate_correspond_path(refresh_info.timestamp).map_err(|e| {
        log::debug!("[BE] ERROR generating correspond path: {}", e);
        e
    })?;
    log::debug!(
        "[BE] Generated CorrespondPath: {} bytes",
        correspond_path.len()
    );

    // Step 3: Fetch refresh_csrf
    log::debug!("[BE] Fetching refresh_csrf...");
    let refresh_csrf = fetch_refresh_csrf(app, &correspond_path)
        .await
        .map_err(|e| {
            log::debug!("[BE] ERROR fetching refresh_csrf: {}", e);
            e
        })?;
    log::debug!("[BE] Got refresh_csrf: {}", refresh_csrf);

    // Step 4: Call cookie refresh API
    let cookies = get_cookie_header(app);
    let client = Client::new();

    let params = [
        ("csrf", session.bili_jct.clone()),
        ("refresh_csrf", refresh_csrf),
        ("source", "main_web".to_string()),
        ("refresh_token", session.refresh_token.clone()),
    ];

    log::debug!("[BE] Calling refresh API...");
    let response = client
        .post(COOKIE_REFRESH_URL)
        .header("Cookie", &cookies)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh cookie: {}", e))?;

    log::debug!("[BE] Refresh API response status: {}", response.status());

    // Extract new cookies from Set-Cookie headers
    let new_cookies = extract_cookies_from_response(&response);
    log::debug!("[BE] Extracted {} cookies from response", new_cookies.len());

    // Get response body as text first for debugging
    let response_text = response.text().await.map_err(|e| {
        log::debug!("[BE] ERROR reading response body: {}", e);
        format!("Failed to read response body: {}", e)
    })?;

    log::debug!("[BE] Response body: {}", response_text);

    let refresh_response: CookieRefreshResponse =
        serde_json::from_str(&response_text).map_err(|e| {
            log::debug!("[BE] ERROR parsing JSON: {}", e);
            format!("Failed to parse refresh response: {}", e)
        })?;

    log::debug!(
        "[BE] Refresh API code: {}, message: {}",
        refresh_response.code,
        refresh_response.message
    );

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

    log::debug!(
        "[BE] Got new refresh_token: {} bytes",
        new_refresh_token.len()
    );

    // Step 5: Confirm refresh (invalidate old refresh_token)
    let new_cookies_header = build_cookie_header(&new_cookies);
    let confirm_params = [
        (
            "csrf",
            new_cookies.get("bili_jct").cloned().unwrap_or_default(),
        ),
        ("refresh_token", session.refresh_token.clone()),
    ];

    log::debug!("[BE] Confirming refresh...");
    let confirm_response: ConfirmRefreshResponse = client
        .post(CONFIRM_REFRESH_URL)
        .header("Cookie", &new_cookies_header)
        .form(&confirm_params)
        .send()
        .await
        .map_err(|e| format!("Failed to confirm refresh: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse confirm response: {}", e))?;

    log::debug!(
        "[BE] Confirm response code: {}, message: {}",
        confirm_response.code,
        confirm_response.message
    );

    // Step 6: Build new session and save
    let new_session = Session {
        sessdata: new_cookies.get("SESSDATA").cloned().unwrap_or_default(),
        bili_jct: new_cookies.get("bili_jct").cloned().unwrap_or_default(),
        dede_user_id: new_cookies.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id_ck_md5: new_cookies
            .get("DedeUserID__ckMd5")
            .cloned()
            .unwrap_or_default(),
        refresh_token: new_refresh_token,
        timestamp: chrono::Utc::now().timestamp_millis(),
        uname: session.uname,   // Preserve username from old session
        buvid3: session.buvid3, // Preserve buvid3 from old session
        buvid4: session.buvid4, // Preserve buvid4 from old session
    };

    // Update cookie cache
    update_cookie_cache(app, &new_session);

    // Save new session
    save_session(app, &new_session).await?;

    log::debug!(
        "[BE] Session saved successfully. New SESSDATA: {} bytes, timestamp: {}",
        new_session.sessdata.len(),
        new_session.timestamp
    );

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
