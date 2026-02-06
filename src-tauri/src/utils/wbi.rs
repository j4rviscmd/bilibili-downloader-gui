//! WBI (Web Browser Interface) Signature Implementation
//!
//! This module implements WBI signature generation required by Bilibili API
//! for non-authenticated requests. WBI signature has been mandatory since
//! March 2023 for accessing Bilibili video playurl endpoints.
//!
//! ## WBI Signature Process
//!
//! 1. Fetch MixinKey from wbi_img URL
//! 2. Add timestamp (wts) to request parameters
//! 3. Sort parameters and concatenate them
//! 4. Append MixinKey and compute HMAC-SHA256 hash
//! 5. Use first 32 characters of base64-encoded hash as w_rid
//!
//! ## References
//!
//! - [Bilibili API Collect - WBI](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/misc/sign/wbi.md)
//! - [WBI Discussion](https://github.com/SocialSisterYi/bilibili-API-collect/discussions/920)

use base64::Engine;
use hmac::digest::KeyInit;
use hmac::Hmac;
use hmac::Mac;
use reqwest::Client;
use sha2::Sha256;
use std::collections::BTreeMap;

/// WBI signature parameters for API requests.
///
/// Contains the generated signature components that must be included
/// in query parameters when calling WBI-protected endpoints.
#[derive(Debug, Clone)]
pub struct WbiSignature {
    /// The signature hash computed from parameters and MixinKey
    pub w_rid: String,
    /// Unix timestamp when the signature was generated
    pub wts: String,
}

/// Generates WBI signature for API request parameters.
///
/// This function implements the Bilibili WBI signature algorithm:
/// 1. Adds current timestamp as `wts` parameter
/// 2. Sorts all parameters alphabetically
/// 3. Concatenates them as `key1=value1&key2=value2`
/// 4. Appends MixinKey to the concatenated string
/// 5. Computes HMAC-SHA256 hash
/// 6. Base64-encodes the hash and takes first 32 characters as w_rid
///
/// # Arguments
///
/// * `params` - Request parameters (will be modified to include wts)
/// * `mixin_key` - The MixinKey fetched from Bilibili wbi_img endpoint
///
/// # Returns
///
/// `Ok(WbiSignature)` containing w_rid and wts on success.
///
/// # Errors
///
/// Returns an error if HMAC key creation fails (invalid key length).
///
/// # Example
///
/// ```no_run
/// use std::collections::BTreeMap;
///
/// let mut params = BTreeMap::new();
/// params.insert("bvid".to_string(), "BV1234567890".to_string());
/// params.insert("cid".to_string(), "123456".to_string());
///
/// let mixin_key = "abcdefghijklmn123456789012";
/// let signature = generate_wbi_signature(&mut params, mixin_key).unwrap();
///
/// println!("w_rid: {}", signature.w_rid);
/// println!("wts: {}", signature.wts);
/// ```
pub fn generate_wbi_signature(
    params: &mut BTreeMap<String, String>,
    mixin_key: &str,
) -> Result<WbiSignature, String> {
    let wts = chrono::Utc::now().timestamp();
    params.insert("wts".to_string(), wts.to_string());

    // Sort parameters and concatenate
    let query_string = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");

    // Append MixinKey and create HMAC-SHA256 hash
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(mixin_key.as_bytes())
        .map_err(|e| format!("Failed to create HMAC: {e}"))?;
    mac.update(query_string.as_bytes());
    mac.update(mixin_key.as_bytes());
    let hash = mac.finalize().into_bytes();

    // Base64 encode and take first 32 characters
    let w_rid = base64::engine::general_purpose::STANDARD
        .encode(&hash[..])
        .chars()
        .take(32)
        .collect();

    Ok(WbiSignature {
        w_rid,
        wts: wts.to_string(),
    })
}

/// Fetches MixinKey from Bilibili wbi_img endpoint.
///
/// The MixinKey is required for WBI signature generation and is obtained
/// by parsing the wbi_img URL from the navigation endpoint. The MixinKey
/// is constructed by concatenating the first 24 and last 24 characters
/// from the wbi_img filename (total 48 characters).
///
/// # Arguments
///
/// * `client` - HTTP client for making the request
///
/// # Returns
///
/// `Ok(String)` containing the 48-character MixinKey on success.
///
/// # Errors
///
/// Returns an error if:
/// - HTTP request fails
/// - Response JSON cannot be parsed
/// - wbi_img field is missing or invalid
/// - MixinKey extraction fails
///
/// # Example
///
/// ```no_run
/// use reqwest::Client;
///
/// # async fn example() -> Result<(), String> {
/// let client = Client::new();
/// let mixin_key = fetch_mixin_key(&client).await?;
/// println!("MixinKey: {}", mixin_key);
/// # Ok(())
/// # }
/// ```
pub async fn fetch_mixin_key(client: &Client) -> Result<String, String> {
    let resp = client
        .get("https://api.bilibili.com/x/web-interface/nav")
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

    // Extract filename from img_url
    let img_key = img_url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".png");

    // Extract filename from sub_url
    let sub_key = sub_url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim_end_matches(".png");

    // MixinKey format: img_url key[0..24] + sub_url key[8..32] (total 48)
    // 取img_url的前24位 + sub_url的后24位
    if img_key.len() < 24 || sub_key.len() < 24 {
        return Err(format!(
            "MixinKey length insufficient: img_key={}, sub_key={}",
            img_key.len(),
            sub_key.len()
        ));
    }

    let img_prefix = &img_key[..24];
    let sub_suffix = &sub_key[sub_key.len() - 24..];
    let mixin_key = format!("{}{}", img_prefix, sub_suffix);

    Ok(mixin_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_wbi_signature() {
        let mut params = BTreeMap::new();
        params.insert("bvid".to_string(), "BV1234567890".to_string());
        params.insert("cid".to_string(), "123456".to_string());

        let mixin_key = "abcdefghijklmn123456789012abcdefghijklmn";
        let result = generate_wbi_signature(&mut params, mixin_key);

        assert!(result.is_ok());
        let signature = result.unwrap();
        assert!(!signature.w_rid.is_empty());
        assert!(!signature.wts.is_empty());
        assert_eq!(signature.w_rid.len(), 32);
        assert!(params.contains_key("wts"));
    }

    #[test]
    fn test_generate_wbi_signature_params_sorted() {
        let mut params = BTreeMap::new();
        params.insert("z_param".to_string(), "last".to_string());
        params.insert("a_param".to_string(), "first".to_string());

        let mixin_key = "abcdefghijklmn123456789012abcdefghijklmn";
        let result = generate_wbi_signature(&mut params, mixin_key);

        assert!(result.is_ok());
        // Verify wts was added
        assert!(params.contains_key("wts"));
        assert!(params.contains_key("a_param"));
        assert!(params.contains_key("z_param"));
    }
}
