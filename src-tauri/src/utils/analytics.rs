//! Google Analytics 4 Integration (Currently Disabled)
//!
//! This module provides GA4 event tracking functionality for monitoring
//! application usage, downloads, and errors. All analytics features are
//! currently disabled but remain in the codebase for potential future use.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use reqwest::Client;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

/// Global tracking of download start times for duration calculation.
static DOWNLOAD_STARTS: Lazy<Mutex<HashMap<String, Instant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Google Analytics 4 Measurement Protocol endpoint.
const GA_ENDPOINT: &str = "https://www.google-analytics.com/mp/collect";

/// GA4 Measurement ID from build-time environment variable.
static GA_MEASUREMENT_ID: Option<&'static str> = option_env!("GA_MEASUREMENT_ID");

/// GA4 API Secret from build-time environment variable.
static GA_API_SECRET: Option<&'static str> = option_env!("GA_API_SECRET");

/// Initializes analytics and sends initial events.
///
/// This function:
/// 1. Checks for GA credentials (returns early if missing)
/// 2. Creates or loads a persistent client ID
/// 3. Detects first install or version updates
/// 4. Sends appropriate events (first_install, app_update, or app_start)
///
/// Currently disabled - will not send any events unless credentials are provided.
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
pub async fn init_analytics(app: &AppHandle) {
    // If secrets are missing (empty), skip (build-time embedding should set them)
    if GA_MEASUREMENT_ID.unwrap_or("").is_empty() || GA_API_SECRET.unwrap_or("").is_empty() {
        #[cfg(debug_assertions)]
        println!("[GA DISABLED] init_analytics missing GA_MEASUREMENT_ID/GA_API_SECRET");
        return;
    }

    let lib_path = crate::utils::paths::get_lib_path(app);
    let analytics_dir = lib_path.join(".analytics");
    let _ = fs::create_dir_all(&analytics_dir);

    let client_id = get_or_create_client_id(&analytics_dir);

    let version_current = env!("CARGO_PKG_VERSION");
    let last_version_path = analytics_dir.join("last_version");
    let mut is_first_install = false;
    let mut is_update = false;
    let prev_version_opt = if last_version_path.exists() {
        match fs::read_to_string(&last_version_path) {
            Ok(prev) => {
                if prev.trim() != version_current {
                    is_update = true;
                }
                Some(prev.trim().to_string())
            }
            Err(_) => None,
        }
    } else {
        is_first_install = true;
        None
    };

    // Persist current version
    let _ = fs::write(&last_version_path, version_current);

    // Events
    if is_first_install {
        let mut p = Map::new();
        p.insert("app_version".into(), Value::from(version_current));
        p.insert("os".into(), Value::from(std::env::consts::OS));
        let _ = send_event_internal(&client_id, "first_install", p).await;
    } else if is_update {
        let mut p = Map::new();
        p.insert(
            "prev_version".into(),
            Value::from(prev_version_opt.unwrap_or_default()),
        );
        p.insert("new_version".into(), Value::from(version_current));
        p.insert("os".into(), Value::from(std::env::consts::OS));
        let _ = send_event_internal(&client_id, "app_update", p).await;
    }

    // Always app_start
    let mut p = Map::new();
    p.insert("app_version".into(), Value::from(version_current));
    p.insert("os".into(), Value::from(std::env::consts::OS));
    let _ = send_event_internal(&client_id, "app_start", p).await;
}

/// Records a download button click event.
///
/// Currently disabled - no events are sent unless GA credentials are configured.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `download_id` - Unique identifier for the download
pub async fn record_download_click(app: &AppHandle, download_id: &str) {
    if GA_MEASUREMENT_ID.unwrap_or("").is_empty() || GA_API_SECRET.unwrap_or("").is_empty() {
        #[cfg(debug_assertions)]
        println!("[GA DISABLED] record_download_click skipped (missing GA secrets)");
        return;
    }
    let lib_path = crate::utils::paths::get_lib_path(app);
    let client_id_path = lib_path.join(".analytics/client_id");
    let client_id = fs::read_to_string(client_id_path).unwrap_or_else(|_| "".into());
    if client_id.is_empty() {
        return;
    }

    let mut p = Map::new();
    p.insert("download_id".into(), Value::from(download_id));
    let _ = send_event_internal(&client_id, "download_click", p).await;
}

/// Marks the start time of a download for duration tracking.
///
/// Stores the current instant in a global map for later duration calculation
/// when the download completes.
///
/// # Arguments
///
/// * `download_id` - Unique identifier for the download
pub fn mark_download_start(download_id: &str) {
    let mut map = DOWNLOAD_STARTS.lock().unwrap();
    map.insert(download_id.to_string(), Instant::now());
}

/// Records download completion and sends result event.
///
/// Calculates download duration and extracts error category if applicable.
/// Currently disabled - no events are sent unless GA credentials are configured.
///
/// # Arguments
///
/// * `app` - Tauri application handle
/// * `download_id` - Unique identifier for the download
/// * `success` - Whether the download completed successfully
/// * `err_code` - Optional error code if the download failed
pub async fn finish_download(
    app: &AppHandle,
    download_id: &str,
    success: bool,
    err_code: Option<&str>,
) {
    if GA_MEASUREMENT_ID.unwrap_or("").is_empty() || GA_API_SECRET.unwrap_or("").is_empty() {
        #[cfg(debug_assertions)]
        println!("[GA DISABLED] finish_download skipped (missing GA secrets)");
        return;
    }
    let start_opt = {
        let mut map = DOWNLOAD_STARTS.lock().unwrap();
        map.remove(download_id)
    };
    let duration_ms = start_opt
        .map(|inst| inst.elapsed().as_millis() as u64)
        .unwrap_or(0);

    let lib_path = crate::utils::paths::get_lib_path(app);
    let client_id_path = lib_path.join(".analytics/client_id");
    let client_id = fs::read_to_string(client_id_path).unwrap_or_else(|_| "".into());
    if client_id.is_empty() {
        return;
    }

    let mut p = Map::new();
    p.insert("download_id".into(), Value::from(download_id));
    p.insert(
        "status".into(),
        Value::from(if success { "success" } else { "failed" }),
    );
    p.insert("duration_ms".into(), Value::from(duration_ms));
    if let Some(code) = err_code {
        if let Some(cat) = extract_error_category(code) {
            p.insert("error_category".into(), Value::from(cat));
        }
    }
    let _ = send_event_internal(&client_id, "download_result", p).await;
}

/// Extracts the error category from an error string.
///
/// Parses error codes in the format "ERR::CATEGORY::details" and returns
/// the first component after "ERR::".
///
/// # Arguments
///
/// * `err` - Error string to parse
///
/// # Returns
///
/// Returns the error category if the format is valid, `None` otherwise.
///
/// # Examples
///
/// ```
/// // "ERR::NETWORK::timeout" -> Some("NETWORK")
/// // "ERR::DISK_FULL" -> Some("DISK_FULL")
/// // "other error" -> None
/// ```
fn extract_error_category(err: &str) -> Option<String> {
    if let Some(rest) = err.strip_prefix("ERR::") {
        // Take up to next '::'
        let parts: Vec<&str> = rest.split("::").collect();
        if !parts.is_empty() {
            return Some(parts[0].to_string());
        }
    }
    None
}

/// Gets or creates a client ID file for analytics.
///
/// Reads an existing client ID from the file, or generates a new UUID v4
/// if the file doesn't exist or cannot be read.
///
/// # Arguments
///
/// * `dir` - Directory path where the client_id file is stored
///
/// # Returns
///
/// Returns the client ID as a string.
fn get_or_create_client_id(dir: &Path) -> String {
    let path = dir.join("client_id");
    if path.exists() {
        if let Ok(val) = fs::read_to_string(&path) {
            return val.trim().to_string();
        }
    }
    let uuid = uuid_v4();
    let _ = fs::write(&path, &uuid);
    uuid
}

/// Generates a UUID v4 (pseudo-random) without external crate dependencies.
///
/// Creates a UUID v4 compliant identifier using the system's entropy source.
/// Sets the appropriate version (4) and variant (2) bits according to RFC 4122.
///
/// # Returns
///
/// Returns a UUID v4 string in the format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.
fn uuid_v4() -> String {
    use rand::rngs::StdRng;
    use rand::{RngCore, SeedableRng};
    let mut rng = StdRng::from_entropy();
    let mut bytes = [0u8; 16];
    rng.fill_bytes(&mut bytes);
    // Set variant and version bits
    bytes[6] = (bytes[6] & 0x0F) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // variant 2
    let hex = bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>();
    format!(
        "{}{}{}{}-{}{}-{}{}-{}{}-{}{}{}{}{}{}",
        hex[0],
        hex[1],
        hex[2],
        hex[3],
        hex[4],
        hex[5],
        hex[6],
        hex[7],
        hex[8],
        hex[9],
        hex[10],
        hex[11],
        hex[12],
        hex[13],
        hex[14],
        hex[15]
    )
}

/// Sends an analytics event to Google Analytics 4.
///
/// Constructs a GA4 Measurement Protocol request with event data and sends
/// it to the GA4 endpoint. Automatically adds app_version, os, and timestamp
/// to the event parameters. In debug builds, uses the debug endpoint and
/// logs validation messages.
///
/// Currently disabled - no events are sent unless GA credentials are configured.
///
/// # Arguments
///
/// * `client_id` - Unique client identifier for this user
/// * `name` - Event name (e.g., "first_install", "download_result")
/// * `params` - Event parameters as a JSON object map
///
/// # Returns
///
/// Returns `Ok(())` on success, swallows errors to prevent disrupting the app.
async fn send_event_internal(
    client_id: &str,
    name: &str,
    mut params: Map<String, Value>,
) -> Result<(), String> {
    params.insert("app_version".into(), Value::from(env!("CARGO_PKG_VERSION")));
    params.insert("os".into(), Value::from(std::env::consts::OS));
    params.insert("timestamp_ms".into(), Value::from(current_time_ms() as i64));

    let mut event_obj = Map::new();
    event_obj.insert("name".into(), Value::from(name));
    event_obj.insert("params".into(), Value::Object(params));

    let body = json!({
        "client_id": client_id,
        "events": [Value::Object(event_obj)],
    });

    // Debug モード判定: release build では GA_DEBUG=1 を指定しても無効 (cfg 判定)
    #[cfg(debug_assertions)]
    let debug_mode = true;
    #[cfg(not(debug_assertions))]
    let debug_mode = option_env!("GA_DEBUG") == Some("1");

    let endpoint = if debug_mode {
        "https://www.google-analytics.com/debug/mp/collect"
    } else {
        GA_ENDPOINT
    };

    let url = format!(
        "{endpoint}?measurement_id={}&api_secret={}",
        GA_MEASUREMENT_ID.unwrap_or(""),
        GA_API_SECRET.unwrap_or("")
    );
    let client = Client::new();
    let resp = client.post(url).json(&body).send().await;
    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            if debug_mode {
                // Debug エンドポイントは常に 200 で JSON を返す想定
                let parsed = r.json::<serde_json::Value>().await.ok();
                let mut msgs: Vec<String> = Vec::new();
                if let Some(p) = parsed.as_ref() {
                    if let Some(arr) = p.get("validationMessages").and_then(|v| v.as_array()) {
                        for m in arr.iter().take(5) {
                            if let Some(desc) = m.get("description").and_then(|d| d.as_str()) {
                                msgs.push(desc.to_string());
                            }
                        }
                    }
                }
                #[cfg(debug_assertions)]
                println!(
                    "[GA DEBUG] event='{}' status={} messages_count={} first={:?}",
                    name,
                    status,
                    msgs.len(),
                    msgs
                );
            } else if !r.status().is_success() {
                // 非 debug で失敗時は swallow
                return Ok(());
            }
            Ok(())
        }
        Err(e) => {
            if debug_mode {
                #[cfg(debug_assertions)]
                println!("[GA DEBUG] event='{}' request error={}", name, e);
            }
            Ok(()) // swallow
        }
    }
}

/// Gets the current Unix timestamp in milliseconds.
///
/// # Returns
///
/// Returns the number of milliseconds since the Unix epoch, or 0 if the
/// system time is before the epoch.
fn current_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
