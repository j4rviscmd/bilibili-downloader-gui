//! Manual Cookie Login
//!
//! Why: this third login method exists because browser-cookie auto-read
//! cannot be extended beyond Firefox — decrypting Chrome's cookie key needs
//! a macOS Keychain prompt that re-appears on every launch of an unsigned
//! app, so the UX never holds up (Issue #590, continuing the #239
//! analysis). Pasting from DevTools is the sanctioned path for users of
//! other browsers.
//!
//! Lets the user paste a raw Cookie header string (copied from browser
//! DevTools) or a JSON object and turn it into a stored session. The flow:
//!
//! 1. Parse the pasted text into a [`Session`]
//! 2. Fetch buvid3/buvid4 for WBI signing (same as QR login)
//! 3. Verify against the nav API with a temporary cookie header
//! 4. Only on a verified login, commit to the cookie cache and encrypted
//!    session storage
//!
//! Expiry policy matches QR: an expired session is surfaced as not-logged-in
//! by the live nav check, but the stored session is kept until the user
//! pastes a new cookie or logs out.

use crate::handlers::qr_login;
use crate::models::qr_login::{LoginMethod, Session};
use tauri::AppHandle;

/// Parses a pasted cookie text into a [`Session`].
///
/// Accepted formats:
/// - Raw `Cookie` header string: `SESSDATA=xxx; bili_jct=yyy`
///   - Leading `cookie:` prefix (case-insensitive) is tolerated
///   - Both `;` and newline are accepted as separators
/// - JSON object of string values: `{"SESSDATA": "xxx", ...}`
///
/// `SESSDATA` is required; every other field is optional (a session without
/// `bili_jct` can read data but CSRF-protected writes will fail).
///
/// # Errors
///
/// Returns `ERR::MANUAL_COOKIE_MISSING_SESSDATA` when no SESSDATA is
/// present, `ERR::MANUAL_COOKIE_FORMAT_INVALID` when nothing parseable
/// remains after stripping the prefix.
pub(crate) fn parse_cookie_text(text: &str) -> Result<Session, String> {
    let mut trimmed = text.trim();
    // `get(..7)` instead of `[..7]`: slicing panics when byte 7 is not a
    // char boundary (e.g. pasted CJK text), and `None` can never equal the
    // all-ASCII "cookie:" prefix, so the semantics are identical.
    if trimmed
        .get(..7)
        .is_some_and(|p| p.eq_ignore_ascii_case("cookie:"))
    {
        trimmed = trimmed[7..].trim();
    }

    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    if trimmed.starts_with('{') {
        let parsed: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|_| "ERR::MANUAL_COOKIE_FORMAT_INVALID".to_string())?;
        let object = parsed
            .as_object()
            .ok_or_else(|| "ERR::MANUAL_COOKIE_FORMAT_INVALID".to_string())?;
        for (key, value) in object {
            if let Some(value) = value.as_str() {
                fields.insert(key.clone(), value.to_string());
            }
        }
    } else {
        for part in trimmed.replace('\n', ";").split(';') {
            let Some((key, value)) = part.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            // Valid cookie names never contain whitespace; this filters
            // arbitrary pasted text without failing the whole input.
            if key.is_empty() || key.chars().any(char::is_whitespace) {
                continue;
            }
            fields.insert(key.to_string(), value.to_string());
        }
    }

    let sessdata = fields.get("SESSDATA").cloned().unwrap_or_default();
    if sessdata.is_empty() {
        if fields.is_empty() {
            return Err("ERR::MANUAL_COOKIE_FORMAT_INVALID".to_string());
        }
        return Err("ERR::MANUAL_COOKIE_MISSING_SESSDATA".to_string());
    }

    Ok(Session {
        sessdata,
        bili_jct: fields.get("bili_jct").cloned().unwrap_or_default(),
        dede_user_id: fields.get("DedeUserID").cloned().unwrap_or_default(),
        dede_user_id_ck_md5: fields.get("DedeUserID__ckMd5").cloned().unwrap_or_default(),
        // Manual paste never yields a refresh token; renewal is a re-paste.
        refresh_token: String::new(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        uname: String::new(),
        buvid3: String::new(),
        buvid4: String::new(),
    })
}

/// Applies a manually pasted cookie text and logs in when it verifies.
///
/// Unlike QR login, an unverifiable paste is rejected outright (nothing is
/// committed): the pasted text is user-typed and suspect by default, so a
/// nav failure or `is_login=false` should surface as an error rather than a
/// silently stored session.
///
/// # Errors
///
/// Returns the parse errors of [`parse_cookie_text`],
/// `ERR::MANUAL_COOKIE_INVALID` when the nav API reports the cookie does not
/// authenticate, or the raw network error string.
pub async fn apply_manual_cookie(app: &AppHandle, text: &str) -> Result<(), String> {
    let mut session = match parse_cookie_text(text) {
        Ok(session) => session,
        Err(e) => {
            // Log the rejection so "nothing happened" is distinguishable from
            // "command was never invoked" when reading app.log.
            log::warn!(
                "[BE] apply_manual_cookie: rejected at parse ({}), input_len={}",
                e,
                text.len()
            );
            return Err(e);
        }
    };
    log::info!(
        "[BE] apply_manual_cookie: parsed sessdata {} bytes, bili_jct {} bytes",
        session.sessdata.len(),
        session.bili_jct.len()
    );

    // Device IDs for WBI signing (mirrors the QR flow; failure is
    // non-fatal there and here).
    match qr_login::fetch_buvid().await {
        Ok((buvid3, buvid4)) => {
            session.buvid3 = buvid3;
            session.buvid4 = buvid4;
        }
        Err(e) => {
            log::warn!(
                "[BE] apply_manual_cookie: failed to fetch buvid3/buvid4: {}",
                e
            );
        }
    }

    // Verify with a temporary header so a failed check never touches the
    // global CookieCache (which may hold a working Firefox login).
    let temp_header = qr_login::build_cookie_header_from_session(&session);
    let user = qr_login::verify_session_with_header(&temp_header)
        .await
        .map_err(|e| {
            log::warn!("[BE] apply_manual_cookie: nav API request failed: {}", e);
            e
        })?;

    if !user.data.is_login {
        log::error!(
            "[BE] apply_manual_cookie: cookie rejected by nav API (code={}), sessdata_len={}",
            user.code,
            session.sessdata.len()
        );
        return Err("ERR::MANUAL_COOKIE_INVALID".to_string());
    }

    if let Some(uname) = user.data.uname {
        session.uname = uname;
    }

    qr_login::commit_session(app, &session, LoginMethod::Manual).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_header_string() {
        let session = parse_cookie_text(
            "SESSDATA=abc%2Cdef; bili_jct=jct123; DedeUserID=42; DedeUserID__ckMd5=md5",
        )
        .unwrap();
        assert_eq!(session.sessdata, "abc%2Cdef");
        assert_eq!(session.bili_jct, "jct123");
        assert_eq!(session.dede_user_id, "42");
        assert_eq!(session.dede_user_id_ck_md5, "md5");
        assert!(session.refresh_token.is_empty());
    }

    #[test]
    fn strips_cookie_prefix_case_insensitive() {
        let session = parse_cookie_text("Cookie: SESSDATA=abc").unwrap();
        assert_eq!(session.sessdata, "abc");
    }

    #[test]
    fn accepts_newline_separators() {
        let session = parse_cookie_text("SESSDATA=abc\nbili_jct=jct").unwrap();
        assert_eq!(session.sessdata, "abc");
        assert_eq!(session.bili_jct, "jct");
    }

    #[test]
    fn parses_json_object() {
        let session =
            parse_cookie_text(r#"{"SESSDATA": "abc", "bili_jct": "jct", "ignored": 1}"#).unwrap();
        assert_eq!(session.sessdata, "abc");
        assert_eq!(session.bili_jct, "jct");
    }

    #[test]
    fn sessdata_only_is_sufficient() {
        let session = parse_cookie_text("SESSDATA=abc").unwrap();
        assert_eq!(session.sessdata, "abc");
        assert!(session.bili_jct.is_empty());
    }

    #[test]
    fn strips_quotes_around_values() {
        let session = parse_cookie_text(r#"SESSDATA="abc"; bili_jct='jct'"#).unwrap();
        assert_eq!(session.sessdata, "abc");
        assert_eq!(session.bili_jct, "jct");
    }

    #[test]
    fn missing_sessdata_is_rejected() {
        let err = parse_cookie_text("bili_jct=jct; DedeUserID=1").unwrap_err();
        assert_eq!(err, "ERR::MANUAL_COOKIE_MISSING_SESSDATA");
    }

    #[test]
    fn garbage_is_rejected_as_invalid_format() {
        // No "=" anywhere: nothing parseable remains.
        let err = parse_cookie_text("hello world no separators").unwrap_err();
        assert_eq!(err, "ERR::MANUAL_COOKIE_FORMAT_INVALID");

        let err = parse_cookie_text("").unwrap_err();
        assert_eq!(err, "ERR::MANUAL_COOKIE_FORMAT_INVALID");

        let err = parse_cookie_text("{not json").unwrap_err();
        assert_eq!(err, "ERR::MANUAL_COOKIE_FORMAT_INVALID");
    }

    #[test]
    fn multi_byte_leading_text_does_not_panic() {
        // Byte 7 of CJK text is not a char boundary; the prefix check must
        // skip (not panic) and the input falls through to the field parser.
        let err = parse_cookie_text("クッキーをここに貼り付け").unwrap_err();
        assert_eq!(err, "ERR::MANUAL_COOKIE_FORMAT_INVALID");
    }
}
