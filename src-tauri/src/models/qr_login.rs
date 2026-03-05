//! QR Code Login Models
//!
//! This module defines structures for Bilibili QR code authentication.
//! The flow consists of:
//! 1. Generate QR code -> get qrcode_key and url
//! 2. Poll status using qrcode_key
//! 3. On success, extract cookies from response

use serde::{Deserialize, Serialize};

/// Response from QR code generation API.
///
/// Contains the QR code URL content and the key for polling.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeGenerateResponse {
    /// Root response code (0 = success)
    pub code: i32,
    /// Error message if any
    pub message: String,
    /// Response data
    pub data: Option<QrCodeGenerateData>,
}

/// QR code generation data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeGenerateData {
    /// QR code content URL (login page)
    pub url: String,
    /// Polling key (32 characters, valid for 180 seconds)
    pub qrcode_key: String,
}

/// Response from QR code polling API.
///
/// Contains the current scan status and cookies on success.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodePollResponse {
    /// Root response code (0 = success)
    pub code: i32,
    /// Error message if any
    pub message: String,
    /// Response data
    pub data: Option<QrCodePollData>,
}

/// QR code poll status data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodePollData {
    /// Cross-domain login URL (contains cookies on success)
    pub url: String,
    /// Refresh token for session renewal
    pub refresh_token: String,
    /// Login timestamp in milliseconds (0 if not logged in)
    pub timestamp: i64,
    /// Status code:
    /// - 0: Login successful
    /// - 86038: QR code expired
    /// - 86090: Scanned but not confirmed
    /// - 86101: Not scanned yet
    #[serde(rename = "code")]
    pub status_code: i32,
    /// Status message
    pub message: String,
}

/// QR code status enum for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum QrCodeStatus {
    /// Waiting for user to scan
    WaitingForScan,
    /// Scanned, waiting for confirmation on mobile
    ScannedWaitingConfirm,
    /// Login successful
    Success,
    /// QR code has expired
    Expired,
    /// Unknown error
    Error,
}

impl From<i32> for QrCodeStatus {
    fn from(code: i32) -> Self {
        match code {
            0 => QrCodeStatus::Success,
            86038 => QrCodeStatus::Expired,
            86090 => QrCodeStatus::ScannedWaitingConfirm,
            86101 => QrCodeStatus::WaitingForScan,
            _ => QrCodeStatus::Error,
        }
    }
}

/// Session data stored after successful login.
///
/// This is persisted using OS keyring for secure storage,
/// enabling automatic login on subsequent app launches.
///
/// This structure is shared across different login methods (QR code, Firefox cookies, etc.)
/// to support future authentication methods.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// SESSDATA cookie value
    #[serde(rename = "sessdata")]
    pub sessdata: String,
    /// CSRF token (bili_jct)
    #[serde(rename = "biliJct")]
    pub bili_jct: String,
    /// User ID
    #[serde(rename = "dedeUserId")]
    pub dede_user_id: String,
    /// MD5 hash of user ID
    #[serde(rename = "dedeUserIdCkMd5")]
    pub dede_user_id__ck_md5: String,
    /// Refresh token for session renewal
    #[serde(rename = "refresh_token")]
    pub refresh_token: String,
    /// Login timestamp
    pub timestamp: i64,
    /// Username (display name)
    #[serde(default)]
    pub uname: String,
}

/// Frontend-facing QR code generation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrCodeResult {
    /// Base64-encoded PNG image of the QR code
    pub qr_code_image: String,
    /// QR code key for polling
    pub qrcode_key: String,
}

/// Frontend-facing poll result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPollResult {
    /// Current status
    pub status: QrCodeStatus,
    /// Status message for display
    pub message: String,
    /// Session data (only present on success)
    pub session: Option<Session>,
}

/// Login method preference.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum LoginMethod {
    /// Use Firefox cookies (default, legacy)
    #[default]
    Firefox,
    /// Use QR code login
    QrCode,
}

/// Stored login state for persistence.
///
/// Note: Session data is stored in OS keyring,/// while only the login method preference is stored in tauri-plugin-store.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginState {
    /// Preferred login method
    pub method: LoginMethod,
    /// Session data (stored in OS keyring, not in store)
    #[serde(rename = "session")]
    pub session: Option<Session>,
}

// Cookie Refresh API Types

/// Response from cookie refresh check API.
///
/// GET https://passport.bilibili.com/x/passport-login/web/cookie/info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRefreshInfoResponse {
    /// Response code (0 = success, -101 = not logged in)
    pub code: i32,
    /// Error message
    pub message: String,
    /// Response data
    pub data: Option<CookieRefreshInfo>,
}

/// Cookie refresh info data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRefreshInfo {
    /// Whether cookie refresh is needed
    pub refresh: bool,
    /// Current timestamp in milliseconds
    pub timestamp: i64,
}

/// Response from cookie refresh API.
///
/// POST https://passport.bilibili.com/x/passport-login/web/cookie/refresh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRefreshResponse {
    /// Response code (0 = success)
    pub code: i32,
    /// Error message
    pub message: String,
    /// Response data
    pub data: Option<CookieRefreshData>,
}

/// Cookie refresh data containing new refresh_token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieRefreshData {
    /// Status (0 = success)
    pub status: i32,
    /// Message
    pub message: String,
    /// New refresh token for next refresh
    #[serde(rename = "refresh_token")]
    pub refresh_token: String,
}

/// Response from refresh confirmation API.
///
/// POST https://passport.bilibili.com/x/passport-login/web/confirm/refresh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmRefreshResponse {
    /// Response code (0 = success)
    pub code: i32,
    /// Error message
    pub message: String,
}
