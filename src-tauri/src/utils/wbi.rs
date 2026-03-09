//! WBI (Web Browser Interface) Signature Implementation
//!
//! This module implements WBI signature generation required by Bilibili API
//! for non-authenticated requests. WBI signature has been mandatory since
//! March 2023 for accessing Bilibili video playurl endpoints.
//!
//! ## WBI Signature Process
//!
//! 1. Fetch MixinKey from wbi_img URL (apply MIXIN_KEY_ENC_TAB shuffle)
//! 2. Add timestamp (wts) to request parameters
//! 3. Sort parameters and concatenate them
//! 4. Append MixinKey and compute MD5 hash
//! 5. Use the 32-character hex MD5 digest as w_rid
//!
//! ## References
//!
//! - [Bilibili API Collect - WBI](https://github.com/SocialSisterYi/bilibili-API-collect/blob/main/docs/misc/sign/wbi.md)

use reqwest::Client;
use std::collections::BTreeMap;

/// Shuffle table used to derive MixinKey from img_key + sub_key.
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/// WBI signature parameters for API requests.
///
/// Contains the generated signature components that must be included
/// in query parameters when calling WBI-protected endpoints.
#[derive(Debug, Clone)]
pub struct WbiSignature {
    /// The MD5 hex signature computed from parameters and MixinKey
    pub w_rid: String,
    /// Unix timestamp when the signature was generated
    pub wts: String,
}

/// Derives MixinKey from the combined img_key + sub_key string
/// by applying the MIXIN_KEY_ENC_TAB shuffle and taking first 32 chars.
fn derive_mixin_key(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    MIXIN_KEY_ENC_TAB
        .iter()
        .filter_map(|&i| chars.get(i))
        .take(32)
        .collect()
}

/// Filters special characters from parameter values per WBI spec.
///
/// Characters `!'()*` must be removed before signing (not URL-encoded).
/// This is a Bilibili-specific requirement for WBI signatures.
fn filter_wbi_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*'))
        .collect()
}

/// Computes WBI signature from sorted parameters and mixin key.
///
/// Internal helper that is deterministic for a given `wts` value,
/// making it directly testable without time-dependent behaviour.
///
/// # Arguments
///
/// * `params` - Sorted request parameters (must already contain `wts`)
/// * `mixin_key` - 32-character MixinKey
///
/// # Returns
///
/// 32-character lowercase MD5 hex digest.
fn compute_wbi_rid(params: &BTreeMap<String, String>, mixin_key: &str) -> String {
    let query_string = params
        .iter()
        .map(|(k, v)| {
            // Filter special characters per WBI spec
            let filtered = filter_wbi_value(v);
            format!("{k}={}", filtered)
        })
        .collect::<Vec<_>>()
        .join("&");
    let to_hash = format!("{}{}", query_string, mixin_key);
    let digest = md5::compute(to_hash.as_bytes());
    format!("{:x}", digest)
}

/// Generates WBI signature for API request parameters.
///
/// This function implements the Bilibili WBI signature algorithm:
/// 1. Adds current timestamp as `wts` parameter
/// 2. Sorts all parameters alphabetically
/// 3. Concatenates them as `key1=value1&key2=value2`
/// 4. Appends MixinKey to the concatenated string
/// 5. Computes MD5 hash and returns the 32-character hex digest as w_rid
///
/// # Arguments
///
/// * `params` - Request parameters (will be modified to include wts)
/// * `mixin_key` - The MixinKey fetched from Bilibili wbi_img endpoint
///
/// # Returns
///
/// `WbiSignature` containing w_rid and wts.
///
/// # Example
///
/// ```no_run
/// use std::collections::BTreeMap;
/// use bilibili_downloader_gui_lib::wbi::generate_wbi_signature;
///
/// let mut params = BTreeMap::new();
/// params.insert("bvid".to_string(), "BV1234567890".to_string());
/// params.insert("cid".to_string(), "123456".to_string());
///
/// let mixin_key = "abcdefghijklmnopqrstuvwxyz123456";
/// let signature = generate_wbi_signature(&mut params, mixin_key);
///
/// println!("w_rid: {}", signature.w_rid);
/// println!("wts: {}", signature.wts);
/// ```
pub fn generate_wbi_signature(
    params: &mut BTreeMap<String, String>,
    mixin_key: &str,
) -> WbiSignature {
    let wts = chrono::Utc::now().timestamp();
    params.insert("wts".to_string(), wts.to_string());
    let w_rid = compute_wbi_rid(params, mixin_key);
    WbiSignature {
        w_rid,
        wts: wts.to_string(),
    }
}

/// Fetches MixinKey from Bilibili wbi_img endpoint.
///
/// The MixinKey is derived by:
/// 1. Extracting img_key and sub_key from the wbi_img URLs
/// 2. Concatenating them (img_key + sub_key = 64 chars)
/// 3. Applying MIXIN_KEY_ENC_TAB shuffle and taking the first 32 chars
///
/// # Arguments
///
/// * `client` - HTTP client for making the request
/// * `cookie` - Optional cookie header value for authenticated requests.
///   Providing a valid session cookie improves reliability since some
///   Bilibili account tiers require authentication to return `wbi_img`.
///
/// # Returns
///
/// `Ok(String)` containing the 32-character MixinKey on success.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - Response JSON cannot be parsed
/// - wbi_img field is missing or invalid
pub async fn fetch_mixin_key(client: &Client, cookie: Option<&str>) -> Result<String, String> {
    log::debug!("[BE] fetch_mixin_key: fetching WBI mixin key");
    let mut req = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(reqwest::header::REFERER, "https://www.bilibili.com");
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch wbi_img: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse wbi_img response: {}", e))?;

    let wbi_img = body
        .pointer("/data/wbi_img")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "wbi_img not found".to_string())?;

    let img_url = wbi_img
        .get("img_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "img_url not found".to_string())?;

    let sub_url = wbi_img
        .get("sub_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "sub_url not found".to_string())?;

    // Extract filename (without extension) from URL
    let img_key = img_url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".png");

    let sub_key = sub_url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".png");

    // Concatenate and apply shuffle
    let raw = format!("{}{}", img_key, sub_key);
    Ok(derive_mixin_key(&raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_wbi_signature_returns_32_char_md5() {
        let mut params = BTreeMap::new();
        params.insert("bvid".to_string(), "BV1234567890".to_string());
        params.insert("cid".to_string(), "123456".to_string());

        let mixin_key = "abcdefghijklmnopqrstuvwxyz123456";
        let signature = generate_wbi_signature(&mut params, mixin_key);

        // MD5 hex digest is always 32 characters
        assert_eq!(signature.w_rid.len(), 32);
        assert!(!signature.wts.is_empty());
        assert!(params.contains_key("wts"));
    }

    #[test]
    fn test_generate_wbi_signature_deterministic() {
        // Use compute_wbi_rid directly to avoid time-dependent behaviour.
        // generate_wbi_signature overwrites wts with the current timestamp,
        // so two sequential calls may produce different w_rid values if
        // they straddle a second boundary. Instead, pin wts explicitly.
        let mixin_key = "abcdefghijklmnopqrstuvwxyz123456";
        let fixed_wts = "1700000000";

        let mut params1 = BTreeMap::new();
        params1.insert("bvid".to_string(), "BV1234567890".to_string());
        params1.insert("wts".to_string(), fixed_wts.to_string());

        let mut params2 = params1.clone();

        let rid1 = compute_wbi_rid(&params1, mixin_key);
        let rid2 = compute_wbi_rid(&params2, mixin_key);

        // Same parameters + same wts → identical w_rid
        assert_eq!(rid1, rid2);
        // Different wts must produce a different w_rid
        params2.insert("wts".to_string(), "1700000001".to_string());
        let rid3 = compute_wbi_rid(&params2, mixin_key);
        assert_ne!(rid1, rid3);
    }

    #[test]
    fn test_generate_wbi_signature_params_sorted() {
        let mut params = BTreeMap::new();
        params.insert("z_param".to_string(), "last".to_string());
        params.insert("a_param".to_string(), "first".to_string());

        let mixin_key = "abcdefghijklmnopqrstuvwxyz123456";
        let signature = generate_wbi_signature(&mut params, mixin_key);

        assert!(params.contains_key("wts"));
        assert!(params.contains_key("a_param"));
        assert!(params.contains_key("z_param"));
        assert_eq!(signature.w_rid.len(), 32);
    }

    #[test]
    fn test_derive_mixin_key_length() {
        // 64-char raw string (typical img_key + sub_key)
        let raw = "abcdefghijklmnopqrstuvwxyz012345ABCDEFGHIJKLMNOPQRSTUVWXYZ678901";
        let key = derive_mixin_key(raw);
        assert_eq!(key.len(), 32);
    }
}
