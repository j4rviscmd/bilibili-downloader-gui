//! QR Code Login Handler
//!
//! This module handles Bilibili QR code authentication flow:
//! 1. Generate QR code image
//! 2. Poll for login status
//! 3. Store session in encrypted file on success
//! 4. Logout (clear session file)
//!
//! # Security
//!
//! Session tokens (SESSDATA, refresh_token, etc.) are encrypted with
//! argon2 + AES-256-GCM and stored in the app data directory.
//! The encryption key is derived from hostname + username.
//!
//! login_state.json (multi-process safe locked JSON store) is only used for
//! non-sensitive settings like the preferred login method.

use std::io::Cursor;
use std::sync::RwLock;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::Luma;
use qrcode::QrCode;
use reqwest::Url;
use tauri::AppHandle;
use tauri::Manager;

use crate::constants;
use crate::handlers::bilibili::build_client;
use crate::models::cookie::CookieCache;
use crate::models::cookie::CookieEntry;
use crate::models::qr_login::{
    BuvidResponse, ConfirmRefreshResponse, CookieRefreshInfo, CookieRefreshInfoResponse,
    CookieRefreshResponse, LoginMethod, LoginState, QrCodeGenerateResponse, QrCodePollResponse,
    QrCodeResult, QrCodeStatus, QrPollResult, Session,
};
use crate::utils::locked_json;
use crate::utils::secure_storage::{EncryptedFileStorage, SecureStorage};

/// Host of the QR login endpoints (generate/poll). They are NOT served on
/// api.bilibili.com (404 there) — see
/// references/bilibili-API-collect/docs/login/login_action/QR.md.
const PASSPORT_BASE: &str = "https://passport.bilibili.com";
/// Bilibili QR code generation API path on [`PASSPORT_BASE`].
const QR_GENERATE_PATH: &str = "/x/passport-login/web/qrcode/generate";
/// Bilibili QR code login polling API path on [`PASSPORT_BASE`].
const QR_POLL_PATH: &str = "/x/passport-login/web/qrcode/poll";
/// Store file name for login method preference (non-sensitive data only).
const STORE_FILE_NAME: &str = "login_state.json";
/// Key used within the store file for login state persistence.
const LOGIN_STATE_KEY: &str = "loginState";

/// Writes `state` to `app_data_dir/login_state.json` under the inter-process
/// lock with an atomic rename (issue #560), preserving any other keys.
fn write_login_state<R: tauri::Runtime>(
    app: &impl Manager<R>,
    state: &crate::models::qr_login::LoginState,
) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join(STORE_FILE_NAME);

    locked_json::with_json_mut(&path, |value| {
        value[LOGIN_STATE_KEY] = serde_json::to_value(state)
            .map_err(|e| format!("Failed to serialize login state: {}", e))?;
        Ok(())
    })
    .map_err(|e| format!("Failed to save login state: {}", e))
}

/// Encrypted file storage instance for persisting session tokens.
static STORAGE: EncryptedFileStorage = EncryptedFileStorage::new();

/// In-memory session cache to avoid repeated file reads and key derivation.
///
/// Three-state sentinel: `None` = not initialized, `Some(None)` = no session,
/// `Some(Some(session))` = session loaded. The sentinel is reset back to
/// `None` by [`delete_session_from_store`] so that the next load attempt
/// re-reads from disk instead of returning a stale "no session" result.
static SESSION_CACHE: RwLock<Option<Option<Session>>> = RwLock::new(None);

/// Returns true if running in E2E test mode (bypasses secure storage).
///
/// Checks the `E2E_TESTING` environment variable. When enabled, all
/// session load/save/delete operations become no-ops so tests can run
/// without touching encrypted files on disk.
pub fn is_e2e_testing() -> bool {
    std::env::var("E2E_TESTING")
        .map(|v| v == "true")
        .unwrap_or(false)
}

/// Maps a poisoned-cache lock error to a `String` error.
///
/// Used as a convenience to convert the `PoisonError` returned by
/// [`RwLock::write`](std::sync::RwLock::write) into the module's
/// `Result<_, String>` signature.
fn cache_lock_err(e: impl std::fmt::Display) -> String {
    format!("Failed to access session cache: {}", e)
}

/// Creates a bilibili cookie entry with the standard host.
///
/// All Bilibili cookies use the `.bilibili.com` host; this helper keeps
/// that knowledge in one place instead of repeating the string literal.
fn bilibili_cookie(name: &str, value: String) -> CookieEntry {
    CookieEntry {
        host: ".bilibili.com".to_string(),
        name: name.to_string(),
        value,
    }
}

/// Builds a `Cookie` header value from a `Session` without touching the
/// global `CookieCache`. Used for temporary verification of a freshly
/// extracted QR session (review P2: avoid polluting the global cache on
/// failure and avoid deleting Firefox cookies on `clear_cookie_cache`).
pub(crate) fn build_cookie_header_from_session(session: &Session) -> String {
    let mut parts = vec![
        format!("SESSDATA={}", session.sessdata),
        format!("bili_jct={}", session.bili_jct),
        format!("DedeUserID={}", session.dede_user_id),
        format!("DedeUserID__ckMd5={}", session.dede_user_id_ck_md5),
    ];
    if !session.buvid3.is_empty() {
        parts.push(format!("buvid3={}", session.buvid3));
    }
    if !session.buvid4.is_empty() {
        parts.push(format!("buvid4={}", session.buvid4));
    }
    parts.join("; ")
}

/// Verifies a session by calling the nav API with a temporary cookie header.
///
/// Does not read or write the global `CookieCache`, so a failed
/// verification never clobbers existing Firefox cookies.
pub(crate) async fn verify_session_with_header(
    cookie_header: &str,
) -> Result<crate::models::frontend_dto::User, String> {
    let api = crate::handlers::bilibili::BiliApi::from_cookie_header("")?;
    verify_session_with_header_in(&api, cookie_header).await
}

/// Transport-injectable variant of [`verify_session_with_header`] (test
/// seam: wiremock tests pass a BiliApi whose base URL points at a local
/// server; the header swap reuses the same client/origin).
async fn verify_session_with_header_in(
    api: &crate::handlers::bilibili::BiliApi,
    cookie_header: &str,
) -> Result<crate::models::frontend_dto::User, String> {
    use crate::models::bilibili_api::UserApiResponse;
    use crate::models::frontend_dto::{User, UserData};

    if cookie_header.is_empty() {
        return Ok(User {
            code: 0,
            message: String::new(),
            data: UserData {
                mid: None,
                uname: None,
                is_login: false,
            },
            has_cookie: false,
        });
    }

    let body = api
        .with_cookie(cookie_header.to_string())
        .get("/x/web-interface/nav")
        .await?
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;

    Ok(User {
        code: body.code,
        message: body.message,
        data: UserData {
            mid: body.data.mid,
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
        has_cookie: true,
    })
}

/// Saves session to encrypted file storage.
///
/// # Errors
///
/// Returns an error if encryption or file write fails.
fn save_session_to_store<R: tauri::Runtime>(
    app: &impl Manager<R>,
    session: &Session,
) -> Result<(), String> {
    if is_e2e_testing() {
        log::info!("[BE] save_session_to_store: skipped (E2E_TESTING)");
        return Ok(());
    }
    log::info!("[BE] save_session_to_store: saving session");
    STORAGE.save(app, session)?;

    // Update cache
    {
        let mut cache = SESSION_CACHE.write().map_err(cache_lock_err)?;
        *cache = Some(Some(session.clone()));
    }

    log::info!("[BE] save_session_to_store: session saved successfully");
    Ok(())
}

/// Loads session from encrypted file storage with caching.
///
/// Uses an in-memory cache to avoid repeated file reads.
/// On first call, reads from encrypted file and caches the result.
/// Subsequent calls return the cached value.
///
/// # Returns
///
/// Returns `Ok(Some(session))` if session exists, `Ok(None)` if not found.
///
/// # Errors
///
/// Returns an error if file read or decryption fails.
fn load_session_from_store<R: tauri::Runtime>(
    app: &impl Manager<R>,
) -> Result<Option<Session>, String> {
    if is_e2e_testing() {
        log::info!("[BE] load_session_from_store: skipped (E2E_TESTING)");
        return Ok(None);
    }
    log::info!("[BE] load_session_from_store: loading session");
    // Check cache first
    {
        let cache = SESSION_CACHE.read().map_err(cache_lock_err)?;
        if let Some(cached) = cache.as_ref() {
            log::info!("[BE] load_session_from_store: returning cached session");
            return Ok(cached.clone());
        }
    }

    // Not cached, read from storage
    let result = STORAGE.load(app);

    // Populate cache based on outcome (keeps two-state sentinel consistent).
    // On error, leave cache untouched so the next call retries storage.
    match &result {
        Ok(Some(session)) => {
            log::info!("[BE] load_session_from_store: session loaded successfully");
            let mut cache = SESSION_CACHE.write().map_err(cache_lock_err)?;
            *cache = Some(Some(session.clone()));
        }
        Ok(None) => {
            log::info!("[BE] load_session_from_store: no session found");
            let mut cache = SESSION_CACHE.write().map_err(cache_lock_err)?;
            *cache = Some(None);
        }
        Err(e) => log::error!("[BE] load_session_from_store: {}", e),
    }

    result
}

/// Deletes session from encrypted file storage and clears cache.
///
/// # Errors
///
/// Returns an error if file deletion fails.
fn delete_session_from_store<R: tauri::Runtime>(app: &impl Manager<R>) -> Result<(), String> {
    if is_e2e_testing() {
        log::info!("[BE] delete_session_from_store: skipped (E2E_TESTING)");
        return Ok(());
    }
    log::info!("[BE] delete_session_from_store: deleting session");
    // Clear cache first
    {
        let mut cache = SESSION_CACHE.write().map_err(cache_lock_err)?;
        *cache = None;
    }

    STORAGE.delete(app)?;

    log::info!("[BE] delete_session_from_store: session deleted successfully");
    Ok(())
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
    let api = crate::handlers::bilibili::BiliApi::from_cookie_header("")?;
    let passport = api.with_base(PASSPORT_BASE);
    generate_qr_code_with(&api, &passport).await
}

/// Transport-injectable core of [`generate_qr_code`]: `base` is the
/// anonymous transport; the buvid pre-fetch and the generate request both
/// ride it (the generate call swaps in the buvid Cookie via with_cookie).
async fn generate_qr_code_with(
    base: &crate::handlers::bilibili::BiliApi,
    gen_api: &crate::handlers::bilibili::BiliApi,
) -> Result<QrCodeResult, String> {
    // Pre-fetch buvid3/buvid4 to activate device fingerprint before QR
    // generation. Bilibili passport risk control may require a valid device
    // fingerprint. The returned buvid values are forwarded as `Cookie`
    // headers on the generate request so the server sees a consistent
    // fingerprint (previous code fetched but discarded them, so the next
    // request used a fresh client without cookies).
    // Best-effort: failure is logged but does not block QR generation.
    let buvid_cookie = match fetch_buvid_via(base).await {
        Ok((b3, b4)) => {
            log::info!(
                "[BE] generate_qr_code: pre-fetched buvid3 ({} bytes), buvid4 ({} bytes) to activate fingerprint",
                b3.len(),
                b4.len()
            );
            if b3.is_empty() && b4.is_empty() {
                String::new()
            } else {
                format!("buvid3={}; buvid4={}", b3, b4)
            }
        }
        Err(e) => {
            log::warn!("[BE] generate_qr_code: failed to pre-fetch buvid: {}", e);
            String::new()
        }
    };

    // Call Bilibili QR generate API via the passport transport (Referer
    // always, buvid Cookie only when the pre-fetch succeeded)
    let response = gen_api
        .with_cookie(&buvid_cookie)
        .get(QR_GENERATE_PATH)
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
    let api = crate::handlers::bilibili::BiliApi::from_cookie_header("")?;
    let passport = api.with_base(PASSPORT_BASE);
    poll_qr_status_with(app, &api, &passport, qrcode_key).await
}

/// Transport-injectable core of [`poll_qr_status`] (test seam: wiremock
/// tests pass a BiliApi whose base URL points at a local server; the poll,
/// buvid and nav endpoints all resolve against it by path).
async fn poll_qr_status_with<R: tauri::Runtime>(
    app: &impl Manager<R>,
    api: &crate::handlers::bilibili::BiliApi,
    poll_api: &crate::handlers::bilibili::BiliApi,
    qrcode_key: &str,
) -> Result<QrPollResult, String> {
    log::debug!(
        "[BE] poll_qr_status: polling with qrcode_key={}",
        qrcode_key
    );

    // Call Bilibili QR poll API via the passport transport.
    // `source=main-fe-header` matches the web header login widget; without it
    // some responses omit Set-Cookie headers. get_q percent-encodes the
    // query (the transport's documented invariant for user-visible values).
    let response = poll_api
        .get_q(
            QR_POLL_PATH,
            &[
                ("qrcode_key", qrcode_key.to_string()),
                ("source", "main-fe-header".to_string()),
            ],
        )
        .await
        .map_err(|e| format!("Failed to poll QR status: {}", e))?;

    // Current Bilibili poll responses may leave credentials out of `data.url`
    // and deliver them only as Set-Cookie. Capture headers before consuming
    // the body.
    let set_cookie_values: Vec<String> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();

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
        let mut session = match extract_session(
            &data.url,
            &set_cookie_values,
            &data.refresh_token,
            data.timestamp,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[BE] poll_qr_status: failed to extract session: {}", e);
                return Ok(QrPollResult {
                    status: QrCodeStatus::Error,
                    message: e,
                    session: None,
                });
            }
        };

        // Diagnostic: log extracted cookie lengths for troubleshooting
        // (do not log values themselves to avoid leaking tokens)
        log::info!(
            "[BE] poll_qr_status: extracted sessdata {} bytes, bili_jct {} bytes, dede_user_id={}",
            session.sessdata.len(),
            session.bili_jct.len(),
            session.dede_user_id
        );

        // Fetch buvid3/buvid4 for WBI authentication
        match fetch_buvid_via(api).await {
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

        // Verify session validity using a temporary cookie header so the
        // global `CookieCache` (which may hold Firefox cookies) is not
        // polluted on failure. Only on successful verification do we commit
        // the new cookies to the global cache and persistent storage (review
        // P2).
        let temp_cookie_header = build_cookie_header_from_session(&session);
        match verify_session_with_header_in(api, &temp_cookie_header).await {
            Ok(user) => {
                log::info!(
                    "[BE] poll_qr_status: verification is_login={}, has_cookie={}, uname={:?}, sessdata_len={}, bili_jct_len={}",
                    user.data.is_login,
                    user.has_cookie,
                    user.data.uname,
                    session.sessdata.len(),
                    session.bili_jct.len()
                );
                if !user.data.is_login {
                    log::error!(
                        "[BE] poll_qr_status: login verification failed - is_login=false (code={}), sessdata_len={}, bili_jct_len={}, refresh_token_len={}",
                        user.code,
                        session.sessdata.len(),
                        session.bili_jct.len(),
                        session.refresh_token.len()
                    );
                    return Ok(QrPollResult {
                        status: QrCodeStatus::Error,
                        message: "ERR::QR_COOKIE_REJECTED".to_string(),
                        session: None,
                    });
                }
                if let Some(uname) = user.data.uname {
                    session.uname = uname;
                }
                // Verification succeeded: commit to global cache and storage.
                update_cookie_cache(app, &session);
                save_session(app, &session, LoginMethod::QrCode).await?;
            }
            Err(e) => {
                // Nav API failure is likely transient (network). Keep the
                // session and commit it so a fresh SESSDATA that may actually
                // be valid is not discarded. The frontend's `getUserInfo`
                // verification (QRCodeDisplay) will surface the state and
                // avoid closing the dialog on a false success.
                log::warn!(
                    "[BE] poll_qr_status: nav API failed after QR login, keeping session: {}, sessdata_len={}, bili_jct_len={}",
                    e,
                    session.sessdata.len(),
                    session.bili_jct.len()
                );
                update_cookie_cache(app, &session);
                save_session(app, &session, LoginMethod::QrCode).await?;
            }
        }
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
pub(crate) async fn fetch_buvid() -> Result<(String, String), String> {
    let api = crate::handlers::bilibili::BiliApi::from_cookie_header("")?;
    fetch_buvid_via(&api).await
}

/// Transport-injectable variant of [`fetch_buvid`] (test seam).
pub(crate) async fn fetch_buvid_via(
    api: &crate::handlers::bilibili::BiliApi,
) -> Result<(String, String), String> {
    log::info!("[BE] fetch_buvid: fetching buvid3/buvid4 from API");

    let response = api
        .get("/x/frontend/finger/spi")
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

/// Builds a session from the QR poll payload.
///
/// Credentials may arrive as query params on `data.url` (legacy) and/or as
/// `Set-Cookie` headers on the poll response (current Bilibili clients).
/// Header values overlay URL params. `SESSDATA` and `bili_jct` must be
/// present or login is treated as failed rather than stored as an incomplete
/// session (SESSDATA alone cannot perform authenticated writes).
///
/// This dual-source extraction is critical because recent Bilibili poll
/// responses may return an empty `data.url` and deliver credentials only
/// via `Set-Cookie` (see PR #546). Header extraction uses
/// `parse_set_cookie_values` which handles `; Path=/` attributes and
/// last-write-wins for duplicate names.
fn extract_session(
    url: &str,
    set_cookie_values: &[String],
    refresh_token: &str,
    timestamp: i64,
) -> Result<Session, String> {
    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    if !url.is_empty() {
        if let Ok(parsed_url) = Url::parse(url) {
            for (k, v) in parsed_url.query_pairs() {
                fields.insert(k.to_string(), v.to_string());
            }
        } else {
            log::warn!("[BE] extract_session: failed to parse url, trying Set-Cookie only");
        }
    }

    for (k, v) in parse_set_cookie_values(set_cookie_values) {
        fields.insert(k, v);
    }

    let sessdata = fields.get("SESSDATA").cloned().unwrap_or_default();
    if sessdata.is_empty() {
        log::error!(
            "[BE] extract_session: SESSDATA is empty or missing, url_len={}, cookie_headers={}, refresh_token_len={}, timestamp={}",
            url.len(),
            set_cookie_values.len(),
            refresh_token.len(),
            timestamp
        );
        return Err("ERR::QR_SESSDATA_MISSING".to_string());
    }

    // A session without the CSRF token can read public data but every
    // authenticated write (favorites, cookie refresh confirm) would fail,
    // so treat it as an incomplete login rather than storing it.
    let bili_jct = fields.get("bili_jct").cloned().unwrap_or_default();
    if bili_jct.is_empty() {
        log::error!(
            "[BE] extract_session: bili_jct is empty or missing (SESSDATA {} bytes), url_len={}, cookie_headers={}, refresh_token_len={}, timestamp={}",
            sessdata.len(),
            url.len(),
            set_cookie_values.len(),
            refresh_token.len(),
            timestamp
        );
        return Err("ERR::QR_SESSDATA_MISSING".to_string());
    }

    Ok(Session {
        sessdata,
        bili_jct,
        dede_user_id: fields.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id_ck_md5: fields.get("DedeUserID__ckMd5").cloned().unwrap_or_default(),
        refresh_token: refresh_token.to_string(),
        timestamp,
        uname: String::new(),
        buvid3: String::new(),
        buvid4: String::new(),
    })
}

/// Extracts session data from the login URL only (legacy helper for tests).
///
/// Thin wrapper around `extract_session` with no Set-Cookie headers.
#[allow(dead_code)]
fn extract_session_from_url(
    url: &str,
    refresh_token: &str,
    timestamp: i64,
) -> Result<Session, String> {
    extract_session(url, &[], refresh_token, timestamp)
}

/// Saves the session to encrypted file storage and login method to store.
///
/// The session tokens are encrypted and stored in the app data directory,
/// while only the login method preference is stored in the regular store.
/// `method` records which flow produced the session (QR code scan or manual
/// paste) so startup restore picks the right branch.
async fn save_session<R: tauri::Runtime>(
    app: &impl Manager<R>,
    session: &Session,
    method: LoginMethod,
) -> Result<(), String> {
    // E2E mode: skip BOTH the encrypted store and the login_state.json
    // write — mock_app's app_data_dir resolves to the real home directory,
    // so an ungated write litters the machine running the tests.
    if is_e2e_testing() {
        log::info!("[BE] save_session: skipped (E2E_TESTING)");
        return Ok(());
    }
    // Save session to encrypted file storage
    save_session_to_store(app, session)?;

    // Save only the login method to store (non-sensitive)
    let login_state = LoginState {
        method,
        session: None, // Don't store session in store
    };

    write_login_state(app, &login_state)?;

    Ok(())
}

/// Commits a verified session for non-QR login flows (manual cookie paste).
///
/// Updates the in-memory cookie cache and persists the session to encrypted
/// storage tagged with the given login method. QR login keeps its own inline
/// commit logic in `poll_qr_status` (it has extra fallback semantics for
/// transient nav failures that manual paste must not inherit).
pub(crate) async fn commit_session(
    app: &AppHandle,
    session: &Session,
    method: LoginMethod,
) -> Result<(), String> {
    update_cookie_cache(app, session);
    save_session(app, session, method).await
}

/// Updates the in-memory cookie cache with QR session cookies.
///
/// Replaces the entire [`CookieCache`] contents with the QR session's
/// cookies so that subsequent Bilibili requests are authenticated.
/// Includes `buvid3`/`buvid4` only when present, since they are required
/// for WBI signing but may not have been fetched yet.
// Why generic over R: production callers pass AppHandle (= AppHandle<Wry>)
// while tests pass tauri::test::mock_app()'s AppHandle<MockRuntime>
// (tauri "test" dev-dependency feature, src-tauri/Cargo.toml).
fn update_cookie_cache<R: tauri::Runtime>(app: &impl Manager<R>, session: &Session) {
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

/// Loads the stored session from encrypted file and updates cookie cache.
///
/// This should be called on app startup to restore login state. Both
/// session-backed methods (QR code, manual paste) restore through this path.
///
/// # Returns
///
/// Returns `Ok(true)` if a stored session was restored, `Ok(false)` if no session exists.
///
/// # Errors
///
/// Returns an error if file read or decryption fails.
pub async fn load_stored_session(app: &AppHandle) -> Result<bool, String> {
    // Check login method preference
    let login_state = get_login_state_from_store(app).await?;

    if !matches!(
        login_state.method,
        LoginMethod::QrCode | LoginMethod::Manual
    ) {
        return Ok(false);
    }

    // Load session from encrypted file storage
    let session = load_session_from_store(app)?;

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

/// Clears the in-memory cookie cache.
///
/// Empties the [`CookieCache`] vector in place. Used during logout and
/// when switching to the Firefox login method so stale QR cookies do not
/// leak into subsequent requests.
fn clear_cookie_cache<R: tauri::Runtime>(app: &impl Manager<R>) {
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(mut guard) = cache.cookies.lock() {
            guard.clear();
        }
    }
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
    clear_cookie_cache(app);

    // Delete session from encrypted file storage
    delete_session_from_store(app)?;

    // Clear login method from store
    write_login_state(app, &LoginState::default())?;

    Ok(())
}

/// Sets the preferred login method.
///
/// The in-memory cookie cache is always cleared on a switch: cookies from
/// the previous method must not keep authenticating requests under the new
/// method (e.g. stale Firefox cookies made `fetch_user` report a live login
/// right after switching to Manual/QR, which looked like a successful
/// login without any scan or paste). The new method becomes truly active
/// on the next login action or restart.
///
/// When switching to `Firefox`, the stored session artifacts (encrypted
/// session file) are also deleted. Switching between the session-backed
/// methods (`QrCode` / `Manual`) keeps the stored session file: the next
/// QR scan or cookie paste overwrites it.
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
    if method == LoginMethod::Firefox {
        if let Err(e) = delete_session_from_store(app) {
            log::warn!("[BE] set_login_method: failed to delete session: {}", e);
        }
    }
    clear_cookie_cache(app);

    // Only store the method, not the session (session is in encrypted file)
    let login_state = LoginState {
        method,
        session: None,
    };

    write_login_state(app, &login_state)?;

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
/// Session data is loaded from encrypted file separately.
async fn get_login_state_from_store<R: tauri::Runtime>(
    app: &impl Manager<R>,
) -> Result<LoginState, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join(STORE_FILE_NAME);

    let mut state: LoginState = locked_json::with_json(&path, |value| {
        let raw = match value.get(LOGIN_STATE_KEY) {
            Some(v) => v.clone(),
            None => return Ok(LoginState::default()),
        };
        serde_json::from_value(raw).map_err(|e| format!("Failed to deserialize login state: {}", e))
    })
    .map_err(|e| format!("Failed to read login state: {}", e))?;

    // Session is not stored in the store anymore, clear it if present from old data
    state.session = None;

    Ok(state)
}

/// Gets the current login state including session from encrypted file.
///
/// # Arguments
///
/// * `app` - Tauri application handle
///
/// # Returns
///
/// Returns the current login state with session (if available from encrypted file).
///
/// # Errors
///
/// Returns an error if file read or decryption fails.
pub async fn get_login_state(app: &AppHandle) -> Result<LoginState, String> {
    let store_state = get_login_state_from_store(app).await?;

    // Load session from encrypted file for session-backed methods (QR,
    // manual paste)
    let session = if matches!(
        store_state.method,
        LoginMethod::QrCode | LoginMethod::Manual
    ) {
        load_session_from_store(app)?
    } else {
        None
    };

    Ok(LoginState {
        method: store_state.method,
        session,
    })
}

// Cookie Refresh API

/// Bilibili cookie info API endpoint for checking if refresh is needed.
const COOKIE_INFO_URL: &str = "https://passport.bilibili.com/x/passport-login/web/cookie/info";
/// Bilibili cookie refresh API endpoint for exchanging refresh tokens.
const COOKIE_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
/// Bilibili confirm refresh endpoint to invalidate the old refresh token.
const CONFIRM_REFRESH_URL: &str =
    "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
/// URL prefix for fetching the CorrespondPath page that contains refresh_csrf.
const CORRESPOND_URL_PREFIX: &str = "https://www.bilibili.com/correspond/1/";

/// Checks if cookie refresh is needed.
///
/// Calls Bilibili's cookie info API to determine if the current session
/// needs to be refreshed. The caller should inspect the `refresh` flag on
/// the returned [`CookieRefreshInfo`] and invoke [`refresh_cookie`] when it
/// is `true` to exchange the stored refresh token for a fresh SESSDATA.
///
/// # Arguments
///
/// * `app` - Tauri application handle used to read the in-memory cookie
///   cache.
///
/// # Returns
///
/// Returns `Ok(CookieRefreshInfo)` when the API responds successfully.
/// When the API returns `-101` (session expired server-side), this function
/// synthesises a refresh request with the current timestamp so the caller
/// can still attempt a refresh rather than treating the session as dead.
///
/// # Errors
///
/// Returns an error if the HTTP request fails, the response cannot be
/// parsed, or the API returns a non-zero code other than `-101`.
pub async fn check_cookie_refresh(app: &AppHandle) -> Result<CookieRefreshInfo, String> {
    let cookies = get_cookie_header(app);
    log::debug!("[BE] Checking with cookies: {} bytes", cookies.len());

    // UA/Referer to match other Bilibili requests: bare clients trip passport
    // risk control, which misreads valid sessions as expired (-101).
    let client = build_client()?;
    let response = client
        .get(COOKIE_INFO_URL)
        .header("Cookie", &cookies)
        .header(reqwest::header::REFERER, constants::REFERER)
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
            let now_ts = chrono::Utc::now().timestamp_millis();
            log::warn!(
                "[BE] Session expired (code: -101), forcing refresh with timestamp: {}",
                now_ts
            );
            Ok(CookieRefreshInfo {
                refresh: true,
                timestamp: now_ts,
            })
        }
        _ => Err(format!("Cookie info API error: {}", info_response.message)),
    }
}

/// Generates CorrespondPath using RSA-OAEP encryption.
///
/// The path is generated by encrypting `refresh_{timestamp}` with Bilibili's
/// public key and hex-encoding the resulting ciphertext. The encrypted path
/// is later appended to [`CORRESPOND_URL_PREFIX`] to fetch `refresh_csrf`.
///
/// # Arguments
///
/// * `timestamp` - Unix-epoch millisecond timestamp used in the plaintext
///   payload. Must match the timestamp sent to the refresh endpoint.
///
/// # Errors
///
/// Returns an error if the public key fails to parse or encryption fails.
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
/// The HTML response contains a div with id '1-name' containing the
/// refresh_csrf token. The token is extracted via a lightweight substring
/// scan rather than a full HTML parser because the markup is a tiny,
/// server-controlled fragment.
///
/// # Arguments
///
/// * `app` - Tauri application handle used to read the current cookie
///   header.
/// * `correspond_path` - Encrypted path segment produced by
///   [`generate_correspond_path`].
///
/// # Errors
///
/// Returns an error if the request fails, the response body cannot be
/// read, or the expected `<div id="1-name">...</div>` element is absent.
async fn fetch_refresh_csrf(app: &AppHandle, correspond_path: &str) -> Result<String, String> {
    let cookies = get_cookie_header(app);
    let url = format!("{}{}", CORRESPOND_URL_PREFIX, correspond_path);
    log::debug!("[BE] fetch_refresh_csrf: URL: {}", url);

    // build_client() supplies the canonical USER_AGENT; the previous inline
    // Chrome/120 string went stale as fingerprinting material.
    let client = build_client()?;
    let response = client
        .get(&url)
        .header("Cookie", &cookies)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.5")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch refresh_csrf: {}", e))?;

    log::debug!(
        "[BE] fetch_refresh_csrf: Response status: {}",
        response.status()
    );

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    log::debug!("[BE] fetch_refresh_csrf: HTML length: {} bytes", html.len());

    // Parse refresh_csrf from HTML: <div id="1-name">{refresh_csrf}</div>
    let start_tag = r#"<div id="1-name">"#;
    let end_tag = "</div>";

    extract_refresh_csrf(&html, start_tag, end_tag)
}

/// Scans `html` for `start_tag`...`end_tag` and returns the enclosed token.
///
/// Split out of `fetch_refresh_csrf` as a pure helper so the markup scan
/// (including both missing-tag branches) is testable without HTTP.
fn extract_refresh_csrf(html: &str, start_tag: &str, end_tag: &str) -> Result<String, String> {
    let start = html.find(start_tag).ok_or_else(|| {
        log::debug!("[BE] extract_refresh_csrf: Could not find start tag");
        "Could not find 1-name div in response".to_string()
    })? + start_tag.len();
    let end = html[start..].find(end_tag).ok_or_else(|| {
        log::debug!("[BE] extract_refresh_csrf: Could not find end tag");
        "Could not find closing div tag".to_string()
    })? + start;

    let refresh_csrf = &html[start..end];
    log::debug!(
        "[BE] extract_refresh_csrf: Found token: {} bytes",
        refresh_csrf.len()
    );
    Ok(refresh_csrf.to_string())
}

/// Refreshes the cookie using the stored refresh_token.
///
/// This function:
/// 1. Generates timestamp for CorrespondPath
/// 2. Fetches refresh_csrf
/// 3. Calls cookie refresh API
/// 4. Confirms the refresh
/// 5. Updates stored session with new cookies and refresh_token
///
/// # Arguments
///
/// * `app` - Tauri application handle. The current session is loaded from
///   the encrypted file store and the in-memory cookie cache is updated in
///   place before returning.
///
/// # Returns
///
/// Returns the new [`Session`] on success. The returned session is also
/// persisted via [`save_session`] so callers do not need to save it again.
///
/// # Errors
///
/// Returns an error if any of the following fail: loading the current
/// session, generating the CorrespondPath, fetching or parsing the
/// `refresh_csrf`, the refresh or confirm HTTP calls, or persisting the
/// updated session to the encrypted store.
pub async fn refresh_cookie(app: &AppHandle) -> Result<Session, String> {
    log::info!("[BE] Starting cookie refresh process...");

    // Generate timestamp for CorrespondPath
    let timestamp = chrono::Utc::now().timestamp_millis();
    log::debug!("[BE] Using timestamp: {}", timestamp);

    // Get current session for refresh_token and csrf
    let login_state = get_login_state(app).await?;
    let session = login_state
        .session
        .ok_or_else(|| "No QR session found".to_string())?;

    log::debug!(
        "[BE] Found session: sessdata={} bytes, refresh_token={} bytes",
        session.sessdata.len(),
        session.refresh_token.len()
    );

    // Step 1: Generate CorrespondPath
    let correspond_path = generate_correspond_path(timestamp)?;
    log::debug!(
        "[BE] Generated CorrespondPath: {} bytes",
        correspond_path.len()
    );

    // Step 2: Fetch refresh_csrf
    log::debug!("[BE] Fetching refresh_csrf...");
    let refresh_csrf = fetch_refresh_csrf(app, &correspond_path).await?;
    log::debug!("[BE] Got refresh_csrf: {}", refresh_csrf);

    // Step 3: Call cookie refresh API
    let cookies = get_cookie_header(app);
    // UA/Referer to match other Bilibili requests (passport risk control).
    let client = build_client()?;

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
        .header(reqwest::header::REFERER, constants::REFERER)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh cookie: {}", e))?;

    log::debug!("[BE] Refresh API response status: {}", response.status());

    // Extract new cookies from Set-Cookie headers
    let set_cookie_values: Vec<String> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();
    let new_cookies = parse_set_cookie_values(&set_cookie_values);
    log::debug!("[BE] Extracted {} cookies from response", new_cookies.len());

    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let refresh_response: CookieRefreshResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

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

    // Step 4: Confirm refresh (invalidate old refresh_token)
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

    // Step 5: Build new session and save
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
    // Why: always re-tag as QrCode instead of the current login_state.method:
    // only QR-origin sessions carry a refresh_token, so a refresh that reaches
    // this point necessarily started from a QR session (a manual paste stores
    // an empty refresh_token and fails in the refresh API before saving — see
    // handlers/manual_login.rs and the Manual branch of handlers/init.rs).
    // Tagging with the live method would relabel a QR-origin session after the
    // user merely switched the preferred method without logging in again.
    save_session(app, &new_session, LoginMethod::QrCode).await?;

    log::debug!(
        "[BE] Session saved successfully. New SESSDATA: {} bytes, timestamp: {}",
        new_session.sessdata.len(),
        new_session.timestamp
    );

    Ok(new_session)
}

/// Gets the Cookie header value from the cache.
///
/// Builds a single `name=value; name=value` string suitable for the
/// `Cookie` HTTP header from the entries currently held in the
/// [`CookieCache`]. Returns an empty string when the cache is missing or
/// locked, which lets callers send an unauthenticated request rather than
/// surfacing a hard error.
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

/// Extracts cookies from Set-Cookie header values.
///
/// Parses each raw `Set-Cookie` value, splitting on the first `=` to
/// capture the name/value pair and ignoring attribute pairs such as
/// `Path=` or `HttpOnly`. When the same cookie name appears multiple
/// times, the last occurrence wins.
///
/// Takes the raw header values (rather than a `reqwest::Response`) so the
/// parsing logic is testable without network plumbing.
fn parse_set_cookie_values(values: &[String]) -> std::collections::HashMap<String, String> {
    let mut cookies = std::collections::HashMap::new();

    for cookie_str in values {
        // Parse "name=value; Path=/; ..."
        if let Some(cookie_part) = cookie_str.split(';').next() {
            if let Some((name, value)) = cookie_part.split_once('=') {
                cookies.insert(name.trim().to_string(), value.trim().to_string());
            }
        }
    }

    cookies
}

/// Builds a Cookie header from a HashMap.
///
/// Inverse of [`parse_set_cookie_values`]: joins each entry with
/// `; ` to form a value suitable for the `Cookie` request header.
fn build_cookie_header(cookies: &std::collections::HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    // ---- PR② e2e: QR login flow via injected transport ----

    use crate::handlers::bilibili::BiliApi;

    /// Sets E2E_TESTING once for this process so the encrypted-session store
    /// becomes a no-op for tests that drive the full poll success path
    /// (save_session would otherwise write to the real app-data path).
    /// Only qr_login's store helpers consult this flag; other modules'
    /// tests are unaffected. edition 2021 -> set_var is a safe fn.
    fn enable_e2e_store_stub() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| std::env::set_var("E2E_TESTING", "true"));
    }

    fn wiremock_api(server: &wiremock::MockServer) -> BiliApi {
        BiliApi::new(reqwest::Client::new(), server.uri(), "")
    }

    async fn mount_json(
        server: &wiremock::MockServer,
        path: &str,
        status: u16,
        body: serde_json::Value,
    ) {
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path(path))
            .respond_with(wiremock::ResponseTemplate::new(status).set_body_json(body))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn fetch_buvid_via_parses_values() {
        let server = wiremock::MockServer::start().await;
        mount_json(
            &server,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {"b_3": "b3-value", "b_4": "b4-value"}}),
        )
        .await;

        assert_eq!(
            fetch_buvid_via(&wiremock_api(&server)).await.unwrap(),
            ("b3-value".to_string(), "b4-value".to_string())
        );
    }

    #[tokio::test]
    async fn fetch_buvid_via_maps_api_error_and_missing_data() {
        let server = wiremock::MockServer::start().await;
        mount_json(
            &server,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": -400, "message": "bad request"}),
        )
        .await;
        let err = fetch_buvid_via(&wiremock_api(&server)).await.unwrap_err();
        assert!(err.contains("Buvid API error"), "got: {err}");

        let server2 = wiremock::MockServer::start().await;
        mount_json(
            &server2,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": 0, "message": "0"}),
        )
        .await;
        let err = fetch_buvid_via(&wiremock_api(&server2)).await.unwrap_err();
        assert!(err.contains("No data"), "got: {err}");
    }

    #[tokio::test]
    async fn generate_qr_code_with_produces_png_data_url() {
        let server = wiremock::MockServer::start().await;
        // buvid pre-fetch + generate on the same origin
        mount_json(
            &server,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {"b_3": "b3", "b_4": "b4"}}),
        )
        .await;
        mount_json(
            &server,
            "/x/passport-login/web/qrcode/generate",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {
                "url": "https://passport.bilibili.com/h5-lg/passportLogin/qr/login?navhidden=1&qrcode_key=key-123",
                "qrcode_key": "key-123",
            }}),
        )
        .await;

        let result = generate_qr_code_with(&wiremock_api(&server), &wiremock_api(&server))
            .await
            .unwrap();
        assert!(result.qr_code_image.starts_with("data:image/png;base64,"));
        assert_eq!(result.qrcode_key, "key-123");

        // The generate request must carry the pre-fetched buvid cookie
        let requests = server.received_requests().await.unwrap();
        let generate_req = requests
            .iter()
            .find(|r| r.url.path().contains("qrcode/generate"))
            .expect("generate request seen");
        let cookie = generate_req
            .headers
            .get("cookie")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(cookie.contains("buvid3=b3"), "cookie was: {cookie:?}");
    }

    #[tokio::test]
    async fn generate_qr_code_survives_buvid_prefetch_failure() {
        let server = wiremock::MockServer::start().await;
        // spi returns non-2xx -> BiliApi status check fails -> buvid skipped
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/frontend/finger/spi"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;
        mount_json(
            &server,
            "/x/passport-login/web/qrcode/generate",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {
                "url": "https://passport.bilibili.com/x?key-456",
                "qrcode_key": "key-456",
            }}),
        )
        .await;

        // Best-effort contract: QR generation proceeds without the fingerprint
        let result = generate_qr_code_with(&wiremock_api(&server), &wiremock_api(&server))
            .await
            .unwrap();
        assert_eq!(result.qrcode_key, "key-456");

        // ...and the generate request went out WITHOUT a cookie
        let requests = server.received_requests().await.unwrap();
        let generate_req = requests
            .iter()
            .find(|r| r.url.path().contains("qrcode/generate"))
            .unwrap();
        assert!(generate_req.headers.get("cookie").is_none());
    }

    #[tokio::test]
    async fn generate_qr_code_maps_api_error_code() {
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/x/frontend/finger/spi"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&server)
            .await;
        mount_json(
            &server,
            "/x/passport-login/web/qrcode/generate",
            200,
            serde_json::json!({"code": 860003, "message": "no qr"}),
        )
        .await;

        let err = generate_qr_code_with(&wiremock_api(&server), &wiremock_api(&server))
            .await
            .unwrap_err();
        assert!(err.contains("QR generate API error"), "got: {err}");
    }

    /// Mounts the poll endpoint returning the given status_code and data.url.
    async fn mount_poll(server: &wiremock::MockServer, status_code: i32, data_url: &str) {
        mount_json(
            server,
            "/x/passport-login/web/qrcode/poll",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {
                "url": data_url,
                "refresh_token": "rt-1",
                "timestamp": 1_700_000_000i64,
                "code": status_code,
                "message": "",
            }}),
        )
        .await;
    }

    #[tokio::test]
    async fn poll_reports_waiting_and_expired_statuses() {
        let app = tauri::test::mock_app();

        let waiting = wiremock::MockServer::start().await;
        mount_poll(&waiting, 86101, "").await;
        let result = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&waiting),
            &wiremock_api(&waiting),
            "k",
        )
        .await
        .unwrap();
        assert!(matches!(
            result.status,
            crate::models::qr_login::QrCodeStatus::WaitingForScan
        ));

        let expired = wiremock::MockServer::start().await;
        mount_poll(&expired, 86038, "").await;
        let result = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&expired),
            &wiremock_api(&expired),
            "k",
        )
        .await
        .unwrap();
        assert!(matches!(
            result.status,
            crate::models::qr_login::QrCodeStatus::Expired
        ));
    }

    #[tokio::test]
    async fn poll_success_commits_cookies_to_cache() {
        enable_e2e_store_stub();
        use crate::models::cookie::CookieCache;
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(CookieCache::default());

        let server = wiremock::MockServer::start().await;
        mount_poll(
            &server,
            0,
            "https://passport.bilibili.com/crossDomain?SESSDATA=s%2Cd&bili_jct=jct&DedeUserID=42&DedeUserID__ckMd5=md5",
        )
        .await;
        mount_json(
            &server,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {"b_3": "b3", "b_4": "b4"}}),
        )
        .await;
        mount_json(
            &server,
            "/x/web-interface/nav",
            200,
            serde_json::json!({"code": 0, "message": "0", "ttl": 1, "data": {
                "mid": 42, "uname": "tester", "isLogin": true, "wbi_img": {"img_url": "", "sub_url": ""},
            }}),
        )
        .await;

        let result = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&server),
            &wiremock_api(&server),
            "k",
        )
        .await
        .unwrap();
        assert!(matches!(
            result.status,
            crate::models::qr_login::QrCodeStatus::Success
        ));

        let cache = app.state::<CookieCache>();
        let guard = cache.cookies.lock().unwrap();
        assert!(guard
            .iter()
            .any(|c| c.name == "SESSDATA" && c.value == "s,d"));
        assert!(guard.iter().any(|c| c.name == "buvid3" && c.value == "b3"));
    }

    #[tokio::test]
    async fn poll_rejected_session_reports_cookie_rejected() {
        enable_e2e_store_stub();

        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        mount_poll(
            &server,
            0,
            "https://passport.bilibili.com/crossDomain?SESSDATA=dead&bili_jct=jct",
        )
        .await;
        mount_json(
            &server,
            "/x/frontend/finger/spi",
            200,
            serde_json::json!({"code": 0, "message": "0", "data": {"b_3": "b3", "b_4": "b4"}}),
        )
        .await;
        mount_json(
            &server,
            "/x/web-interface/nav",
            200,
            serde_json::json!({"code": -101, "message": "not logged in", "ttl": 1, "data": {
                "mid": 0, "uname": "", "isLogin": false, "wbi_img": {"img_url": "", "sub_url": ""},
            }}),
        )
        .await;

        let result = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&server),
            &wiremock_api(&server),
            "k",
        )
        .await
        .unwrap();
        assert!(matches!(
            result.status,
            crate::models::qr_login::QrCodeStatus::Error
        ));
        assert_eq!(result.message, "ERR::QR_COOKIE_REJECTED");
    }

    #[tokio::test]
    async fn poll_api_error_is_returned_as_err() {
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        mount_json(
            &server,
            "/x/passport-login/web/qrcode/poll",
            200,
            serde_json::json!({"code": 860003, "message": "key invalid"}),
        )
        .await;

        let err = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&server),
            &wiremock_api(&server),
            "k",
        )
        .await
        .unwrap_err();
        assert!(err.contains("Poll API error"), "got: {err}");
    }

    #[tokio::test]
    async fn poll_success_without_credentials_reports_extract_error() {
        let app = tauri::test::mock_app();
        let server = wiremock::MockServer::start().await;
        // Success status but the payload carries no SESSDATA anywhere
        mount_poll(&server, 0, "https://passport.bilibili.com/crossDomain?x=1").await;

        let result = poll_qr_status_with(
            app.handle(),
            &wiremock_api(&server),
            &wiremock_api(&server),
            "k",
        )
        .await
        .unwrap();
        assert!(matches!(
            result.status,
            crate::models::qr_login::QrCodeStatus::Error
        ));
        assert!(
            result.message.contains("SESSDATA"),
            "got: {status:?} {msg}",
            status = result.status,
            msg = result.message
        );
    }

    use super::*;

    #[test]
    fn extract_session_from_url_maps_query_params() {
        let url = "https://passport.biligame.com/crossDomain?\
                   DedeUserID=42&DedeUserID__ckMd5=abc&SESSDATA=s%2Cd&bili_jct=jct";
        let session = extract_session_from_url(url, "rt", 1700000000).unwrap();
        assert_eq!(session.sessdata, "s,d", "query values are URL-decoded");
        assert_eq!(session.bili_jct, "jct");
        assert_eq!(session.dede_user_id, "42");
        assert_eq!(session.dede_user_id_ck_md5, "abc");
        assert_eq!(session.refresh_token, "rt");
        assert_eq!(session.timestamp, 1700000000);
        assert!(session.uname.is_empty());
    }

    #[test]
    fn extract_session_from_url_missing_params_default_empty() {
        // SESSDATA is now required; missing SESSDATA must error instead of
        // silently returning an empty session (prevents persisting invalid logins).
        let err =
            extract_session_from_url("https://example.com/crossDomain?x=1", "rt", 1).unwrap_err();
        assert!(
            err.contains("SESSDATA"),
            "missing SESSDATA must error: {err}"
        );
    }

    #[test]
    fn extract_session_from_url_empty_sessdata_errors() {
        let err = extract_session_from_url(
            "https://example.com/crossDomain?SESSDATA=&bili_jct=jct",
            "rt",
            1,
        )
        .unwrap_err();
        assert!(err.contains("SESSDATA"), "empty SESSDATA must error: {err}");
    }

    #[test]
    fn extract_session_missing_bili_jct_errors() {
        // SESSDATA without the CSRF token is an incomplete login: it can read
        // public data but every authenticated write would fail.
        let err =
            extract_session_from_url("https://example.com/crossDomain?SESSDATA=s%2Cd", "rt", 1)
                .unwrap_err();
        assert!(
            err.contains("SESSDATA"),
            "missing bili_jct must error with the credentials code: {err}"
        );
    }

    #[test]
    fn extract_session_bili_jct_from_set_cookie_overlays_missing_url_param() {
        // SESSDATA arrives on data.url, bili_jct only via Set-Cookie.
        let cookies = vec!["bili_jct=csrf; Path=/".to_string()];
        let session = extract_session(
            "https://passport.biligame.com/crossDomain?SESSDATA=s%2Cd",
            &cookies,
            "rt",
            1,
        )
        .unwrap();
        assert_eq!(session.sessdata, "s,d");
        assert_eq!(session.bili_jct, "csrf");
    }

    #[test]
    fn extract_session_from_url_rejects_garbage() {
        assert!(extract_session_from_url("not a url", "rt", 1).is_err());
    }

    #[test]
    fn extract_session_from_set_cookie_when_url_has_no_credentials() {
        let cookies = vec![
            "SESSDATA=from-header; Path=/; HttpOnly".to_string(),
            "bili_jct=csrf; Path=/".to_string(),
            "DedeUserID=99; Path=/".to_string(),
            "DedeUserID__ckMd5=md5; Path=/".to_string(),
        ];
        let session = extract_session("https://www.bilibili.com/", &cookies, "rt", 1).unwrap();
        assert_eq!(session.sessdata, "from-header");
        assert_eq!(session.bili_jct, "csrf");
        assert_eq!(session.dede_user_id, "99");
        assert_eq!(session.dede_user_id_ck_md5, "md5");
    }

    #[test]
    fn extract_session_set_cookie_overlays_url() {
        let url = "https://passport.biligame.com/crossDomain?SESSDATA=from-url&bili_jct=old";
        let cookies = vec!["SESSDATA=from-header; Path=/".to_string()];
        let session = extract_session(url, &cookies, "rt", 1).unwrap();
        assert_eq!(session.sessdata, "from-header");
        assert_eq!(session.bili_jct, "old");
    }

    #[test]
    fn parse_set_cookie_values_keeps_last_and_strips_attributes() {
        let values = vec![
            "SESSDATA=first%2Cvalue; Path=/; HttpOnly; Secure".to_string(),
            // Same cookie set again later must win
            "SESSDATA=second; Path=/".to_string(),
            "bili_jct=jct; Path=/; SameSite=None".to_string(),
            // No '=' pair at all -> ignored
            "novalue".to_string(),
        ];
        let cookies = parse_set_cookie_values(&values);
        assert_eq!(cookies.get("SESSDATA").map(String::as_str), Some("second"));
        assert_eq!(cookies.get("bili_jct").map(String::as_str), Some("jct"));
        assert_eq!(cookies.len(), 2);
    }

    #[test]
    fn build_cookie_header_joins_pairs() {
        let mut cookies = std::collections::HashMap::new();
        cookies.insert("SESSDATA".to_string(), "v1".to_string());
        cookies.insert("buvid3".to_string(), "v2".to_string());
        let header = build_cookie_header(&cookies);
        // HashMap order is unspecified; assert both pairs are present
        assert!(header.contains("SESSDATA=v1"));
        assert!(header.contains("buvid3=v2"));
        assert_eq!(header.matches("; ").count(), 1);
        assert!(build_cookie_header(&std::collections::HashMap::new()).is_empty());
    }

    #[test]
    fn generate_correspond_path_produces_rsa_sized_hex() {
        // RSA-OAEP with a 1024-bit key -> 128-byte ciphertext -> 256 hex chars.
        // OAEP padding is randomized, so output must also be non-deterministic.
        let a = generate_correspond_path(1700000000).unwrap();
        let b = generate_correspond_path(1700000000).unwrap();
        assert_eq!(a.len(), 256, "128-byte ciphertext as lowercase hex");
        assert!(
            a.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "base16ct lower-case encoding"
        );
        assert_ne!(a, b, "randomized OAEP padding");
    }
    // ---- R5: header builders, cookie cache, correspond path ----

    fn r5_session(buvid3: &str, buvid4: &str) -> Session {
        Session {
            sessdata: "sess".into(),
            bili_jct: "jct".into(),
            dede_user_id: "42".into(),
            dede_user_id_ck_md5: "md5".into(),
            refresh_token: "rt".into(),
            timestamp: 1,
            uname: "u".into(),
            buvid3: buvid3.into(),
            buvid4: buvid4.into(),
        }
    }

    #[test]
    fn cookie_header_from_session_includes_buvids_only_when_present() {
        let full = build_cookie_header_from_session(&r5_session("b3", "b4"));
        assert!(full.contains("SESSDATA=sess"));
        assert!(full.contains("bili_jct=jct"));
        assert!(full.contains("DedeUserID=42"));
        assert!(full.contains("DedeUserID__ckMd5=md5"));
        assert!(full.contains("buvid3=b3"));
        assert!(full.contains("buvid4=b4"));

        let bare = build_cookie_header_from_session(&r5_session("", ""));
        assert!(!bare.contains("buvid3"));
        assert!(!bare.contains("buvid4"));
        assert_eq!(
            bare,
            "SESSDATA=sess; bili_jct=jct; DedeUserID=42; DedeUserID__ckMd5=md5"
        );
    }

    #[tokio::test]
    async fn verify_session_with_empty_header_reports_not_logged_in() {
        // Empty header short-circuits to a synthetic logged-out User without
        // any HTTP call (the API path cannot be exercised without transport
        // injection; the guard itself is the contract).
        let user = verify_session_with_header("").await.unwrap();
        assert_eq!(user.code, 0);
        assert!(!user.data.is_login);
        assert!(!user.has_cookie);
        assert!(user.data.mid.is_none());
    }

    #[test]
    fn is_e2e_testing_defaults_false_in_unit_tests() {
        // Unit CI never sets E2E_TESTING; asserting only the unset case keeps
        // the test safe under parallel env mutation.
        if std::env::var("E2E_TESTING").is_err() {
            assert!(!is_e2e_testing());
        }
    }

    #[test]
    fn cache_lock_err_formats_message() {
        assert_eq!(
            cache_lock_err("poisoned"),
            "Failed to access session cache: poisoned"
        );
    }

    #[test]
    fn bilibili_cookie_uses_standard_host() {
        let c = bilibili_cookie("SESSDATA", "v".into());
        assert_eq!(c.host, ".bilibili.com");
        assert_eq!(c.name, "SESSDATA");
        assert_eq!(c.value, "v");
    }

    #[test]
    fn update_and_clear_cookie_cache_via_mock_app() {
        use crate::models::cookie::CookieCache;
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(CookieCache::default());

        update_cookie_cache(app.handle(), &r5_session("b3", ""));
        let cache = app.state::<CookieCache>();
        let guard = cache.cookies.lock().unwrap();
        assert_eq!(guard.len(), 5, "4 standard cookies + buvid3 only");
        assert!(guard.iter().any(|c| c.name == "buvid3"));
        assert!(!guard.iter().any(|c| c.name == "buvid4"));
        assert!(guard.iter().all(|c| c.host == ".bilibili.com"));
        drop(guard);

        update_cookie_cache(app.handle(), &r5_session("", ""));
        let cache2 = app.state::<CookieCache>();
        let guard = cache2.cookies.lock().unwrap();
        assert_eq!(guard.len(), 4, "second update replaces, not appends");
        drop(guard);

        clear_cookie_cache(app.handle());
        assert!(app
            .state::<CookieCache>()
            .cookies
            .lock()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn update_cookie_cache_without_state_is_a_noop() {
        let app = tauri::test::mock_app();
        // No CookieCache managed: must not panic.
        update_cookie_cache(app.handle(), &r5_session("", ""));
        clear_cookie_cache(app.handle());
    }

    #[test]
    fn parse_set_cookie_values_takes_first_attribute_pair() {
        let values = vec![
            "SESSDATA=abc%2Cdef; Path=/; Domain=.bilibili.com; HttpOnly".to_string(),
            " bili_jct = jct ; Path=/".to_string(),
            "novalue".to_string(),
        ];
        let map = parse_set_cookie_values(&values);
        assert_eq!(map.get("SESSDATA").unwrap(), "abc%2Cdef");
        assert_eq!(map.get("bili_jct").unwrap(), "jct");
        assert_eq!(map.len(), 2, "entries without '=' are skipped");
    }

    #[test]
    fn extract_refresh_csrf_scans_token_between_tags() {
        let html = r#"<html><body><div id="1-name">TOKEN123</div></body></html>"#;
        assert_eq!(
            extract_refresh_csrf(html, r#"<div id="1-name">"#, "</div>").unwrap(),
            "TOKEN123"
        );

        let no_start = "<html>no marker</html>";
        assert!(extract_refresh_csrf(no_start, r#"<div id="1-name">"#, "</div>").is_err());

        let no_end = r#"<div id="1-name">TOKEN but never closes"#;
        assert!(extract_refresh_csrf(no_end, r#"<div id="1-name">"#, "</div>").is_err());
    }
}
