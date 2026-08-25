//! Cookie Data Models
//!
//! This module defines structures for storing and managing browser cookies
//! extracted from Firefox.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Represents a single HTTP cookie entry.
///
/// Contains the essential cookie data needed for making authenticated
/// requests to Bilibili.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CookieEntry {
    /// Cookie domain (e.g., ".bilibili.com")
    pub host: String,
    /// Cookie name
    pub name: String,
    /// Cookie value
    pub value: String,
}

/// In-memory cache for storing cookies extracted from Firefox.
///
/// This cache is managed as global state in the Tauri application and
/// avoids repeated reads from the Firefox database.
#[derive(Default)]
pub struct CookieCache {
    /// Thread-safe storage for cookie entries
    pub cookies: Mutex<Vec<CookieEntry>>,
}

/// Development mode flag to simulate non-logged-in user state.
///
/// When enabled, all cookie reads return empty results, forcing
/// non-authenticated API behavior. Only available in debug builds.
#[derive(Default)]
pub struct SimulateLogoutFlag {
    /// Thread-safe flag indicating whether to simulate logout state
    pub enabled: Mutex<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_entry_roundtrips_snake_case_fields() {
        let json = r#"{ "host": ".bilibili.com", "name": "SESSDATA", "value": "v" }"#;
        let entry: CookieEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.host, ".bilibili.com");
        assert_eq!(entry.name, "SESSDATA");
        assert_eq!(entry.value, "v");

        let out = serde_json::to_value(&entry).unwrap();
        assert_eq!(out["host"], ".bilibili.com");
        assert_eq!(out["name"], "SESSDATA");
    }

    #[test]
    fn cookie_entry_default_is_empty() {
        let entry = CookieEntry::default();
        assert!(entry.host.is_empty());
        assert!(entry.name.is_empty());
        assert!(entry.value.is_empty());
    }

    #[test]
    fn cookie_cache_starts_empty_and_accepts_locks() {
        let cache = CookieCache::default();
        assert!(cache.cookies.lock().unwrap().is_empty());

        cache.cookies.lock().unwrap().push(CookieEntry {
            host: ".bilibili.com".into(),
            name: "buvid3".into(),
            value: "x".into(),
        });
        assert_eq!(cache.cookies.lock().unwrap().len(), 1);
    }

    #[test]
    fn simulate_logout_flag_defaults_false() {
        let flag = SimulateLogoutFlag::default();
        assert!(!*flag.enabled.lock().unwrap());

        *flag.enabled.lock().unwrap() = true;
        assert!(*flag.enabled.lock().unwrap());
    }
}
