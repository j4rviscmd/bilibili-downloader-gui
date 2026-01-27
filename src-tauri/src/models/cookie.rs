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
