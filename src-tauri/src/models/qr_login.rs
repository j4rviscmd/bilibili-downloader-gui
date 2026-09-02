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
/// This is persisted in an encrypted file for secure storage,
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
    pub dede_user_id_ck_md5: String,
    /// Refresh token for session renewal
    #[serde(rename = "refresh_token")]
    pub refresh_token: String,
    /// Login timestamp
    pub timestamp: i64,
    /// Username (display name)
    #[serde(default)]
    pub uname: String,
    /// Device ID (buvid3) - required for WBI authentication
    #[serde(default)]
    pub buvid3: String,
    /// Device ID (buvid4) - required for WBI authentication
    #[serde(default)]
    pub buvid4: String,
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
/// Note: Session data is stored in an encrypted file,
/// while only the login method preference is stored in login_state.json
/// (multi-process safe locked JSON store).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginState {
    /// Preferred login method
    pub method: LoginMethod,
    /// Session data (stored in encrypted file, not in store)
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

/// Response from buvid3/buvid4 fetch API.
///
/// GET https://api.bilibili.com/x/frontend/finger/spi
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuvidResponse {
    /// Response code (0 = success)
    pub code: i32,
    /// Response message
    pub message: String,
    /// Response data
    pub data: Option<BuvidData>,
}

/// buvid data containing device IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuvidData {
    /// buvid3 device ID
    #[serde(rename = "b_3")]
    pub b_3: String,
    /// buvid4 device ID
    #[serde(rename = "b_4")]
    pub b_4: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_code_status_maps_api_codes() {
        assert_eq!(QrCodeStatus::from(0), QrCodeStatus::Success);
        assert_eq!(QrCodeStatus::from(86038), QrCodeStatus::Expired);
        assert_eq!(
            QrCodeStatus::from(86090),
            QrCodeStatus::ScannedWaitingConfirm
        );
        assert_eq!(QrCodeStatus::from(86101), QrCodeStatus::WaitingForScan);
        assert_eq!(QrCodeStatus::from(999), QrCodeStatus::Error);
        assert_eq!(QrCodeStatus::from(-1), QrCodeStatus::Error);
    }

    #[test]
    fn qr_code_status_serializes_camel_case() {
        assert_eq!(
            serde_json::to_string(&QrCodeStatus::WaitingForScan).unwrap(),
            r#""waitingForScan""#
        );
        assert_eq!(
            serde_json::to_string(&QrCodeStatus::ScannedWaitingConfirm).unwrap(),
            r#""scannedWaitingConfirm""#
        );
        // Roundtrip through the serialized form
        let status: QrCodeStatus =
            serde_json::from_str(r#""expired""#).expect("camelCase deserialize");
        assert_eq!(status, QrCodeStatus::Expired);
    }

    #[test]
    fn qr_poll_data_renames_status_code_field() {
        let resp: QrCodePollResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "url": "https://passport.biligame.com/crossDomain?...",
                    "refresh_token": "rtoken",
                    "timestamp": 1700000000000,
                    "code": 86101,
                    "message": "未扫码"
                }
            }"#,
        )
        .unwrap();

        let data = resp.data.unwrap();
        // Inner "code" maps to status_code (renamed to avoid clashing with
        // the outer response code).
        assert_eq!(data.status_code, 86101);
        assert_eq!(data.message, "未扫码");
        assert_eq!(data.refresh_token, "rtoken");
        assert_eq!(
            QrCodeStatus::from(data.status_code),
            QrCodeStatus::WaitingForScan
        );
    }

    #[test]
    fn qr_generate_response_parses() {
        let resp: QrCodeGenerateResponse = serde_json::from_str(
            r#"{
                "code": 0, "message": "0",
                "data": {
                    "url": "https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=abc",
                    "qrcode_key": "abcdef0123456789abcdef0123456789"
                }
            }"#,
        )
        .unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.qrcode_key.len(), 32);
        assert!(data.url.contains("qrcode_key=abc"));
    }

    #[test]
    fn session_renames_cookie_field_names() {
        let json = r#"{
            "sessdata": "sd%2Cvalue",
            "biliJct": "csrf",
            "dedeUserId": "42",
            "dedeUserIdCkMd5": "md5hash",
            "refresh_token": "rt",
            "timestamp": 1700000000,
            "uname": "tester",
            "buvid3": "b3",
            "buvid4": "b4"
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert_eq!(session.sessdata, "sd%2Cvalue");
        assert_eq!(session.bili_jct, "csrf");
        assert_eq!(session.dede_user_id, "42");
        assert_eq!(session.dede_user_id_ck_md5, "md5hash");
        assert_eq!(session.refresh_token, "rt");
        assert_eq!(session.timestamp, 1700000000);
        assert_eq!(session.uname, "tester");
        assert_eq!(session.buvid3, "b3");
        assert_eq!(session.buvid4, "b4");

        // Roundtrip keeps the wire format stable (encrypted storage and the
        // frontend both depend on these names).
        let out = serde_json::to_value(&session).unwrap();
        assert_eq!(out["sessdata"], "sd%2Cvalue");
        assert_eq!(out["biliJct"], "csrf");
        assert_eq!(out["dedeUserId"], "42");
        assert_eq!(out["dedeUserIdCkMd5"], "md5hash");
    }

    #[test]
    fn session_missing_optionals_default_empty() {
        // uname/buvid3/buvid4 are optional; core auth fields are required
        // (renamed but NOT defaulted — a session without them is corrupt).
        let session: Session = serde_json::from_str(
            r#"{
                "sessdata": "s", "biliJct": "j", "dedeUserId": "1",
                "dedeUserIdCkMd5": "m", "refresh_token": "r", "timestamp": 1
            }"#,
        )
        .unwrap();
        assert_eq!(session.uname, "");
        assert_eq!(session.buvid3, "");
        assert_eq!(session.buvid4, "");

        let default = Session::default();
        assert_eq!(default.timestamp, 0);
        assert!(default.sessdata.is_empty());
    }

    #[test]
    fn session_rejects_missing_required_auth_fields() {
        // Guarding the intentional strictness: biliJct is required.
        let err = serde_json::from_str::<Session>(
            r#"{ "sessdata": "s", "refresh_token": "r", "timestamp": 1 }"#,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("biliJct"),
            "missing biliJct must fail: {err}"
        );
    }

    #[test]
    fn login_method_defaults_to_firefox() {
        assert_eq!(LoginMethod::default(), LoginMethod::Firefox);
        assert_ne!(LoginMethod::Firefox, LoginMethod::QrCode);

        let method: LoginMethod = serde_json::from_str(r#""qrCode""#).unwrap();
        assert_eq!(method, LoginMethod::QrCode);
        assert_eq!(
            serde_json::to_string(&LoginMethod::Firefox).unwrap(),
            r#""firefox""#
        );
    }

    #[test]
    fn login_state_keeps_session_key() {
        let state = LoginState {
            method: LoginMethod::QrCode,
            session: Some(Session {
                sessdata: "s".into(),
                timestamp: 5,
                ..Default::default()
            }),
        };
        let out = serde_json::to_value(&state).unwrap();
        assert_eq!(out["method"], "qrCode");
        assert_eq!(out["session"]["sessdata"], "s");
        assert_eq!(out["session"]["timestamp"], 5);

        let back: LoginState = serde_json::from_value(out).unwrap();
        assert_eq!(back.method, LoginMethod::QrCode);
        assert_eq!(back.session.unwrap().sessdata, "s");
    }

    #[test]
    fn cookie_refresh_info_parses() {
        let resp: CookieRefreshInfoResponse = serde_json::from_str(
            r#"{ "code": 0, "message": "0", "data": { "refresh": true, "timestamp": 1700000000000 } }"#,
        )
        .unwrap();
        let info = resp.data.unwrap();
        assert!(info.refresh);
        assert_eq!(info.timestamp, 1700000000000);
    }

    #[test]
    fn cookie_refresh_response_parses() {
        let resp: CookieRefreshResponse = serde_json::from_str(
            r#"{ "code": 0, "message": "0", "data": { "status": 0, "message": "m", "refresh_token": "new_rt" } }"#,
        )
        .unwrap();
        assert_eq!(resp.data.unwrap().refresh_token, "new_rt");
    }

    #[test]
    fn buvid_data_renames_b3_b4() {
        let resp: BuvidResponse = serde_json::from_str(
            r#"{ "code": 0, "message": "0", "data": { "b_3": "bv3xxx", "b_4": "bv4yyy" } }"#,
        )
        .unwrap();
        let data = resp.data.unwrap();
        assert_eq!(data.b_3, "bv3xxx");
        assert_eq!(data.b_4, "bv4yyy");
    }

    #[test]
    fn qr_poll_result_wraps_status_and_session() {
        let result = QrPollResult {
            status: QrCodeStatus::Success,
            message: "OK".into(),
            session: Some(Session::default()),
        };
        let out = serde_json::to_value(&result).unwrap();
        assert_eq!(out["status"], "success");
        assert_eq!(out["message"], "OK");
        assert!(out["session"].is_object());

        let back: QrPollResult = serde_json::from_value(out).unwrap();
        assert_eq!(back.status, QrCodeStatus::Success);
        assert!(back.session.is_some());
    }

    #[test]
    fn qr_code_result_serializes_camel_case() {
        let result = QrCodeResult {
            qr_code_image: "iVBORw0K...".into(),
            qrcode_key: "k".into(),
        };
        let out = serde_json::to_value(&result).unwrap();
        assert_eq!(out["qrCodeImage"], "iVBORw0K...");
        assert_eq!(out["qrcodeKey"], "k");
    }
}
