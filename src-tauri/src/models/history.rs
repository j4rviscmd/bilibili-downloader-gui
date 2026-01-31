//! Download History Model
//!
//! This module defines the HistoryEntry structure for tracking
//! downloaded videos in persistent storage.

use serde::{Deserialize, Serialize};

/// Download history entry.
///
/// Represents a single downloaded video record with metadata
/// for history tracking and search functionality.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// Unique identifier for the history entry.
    pub id: String,
    /// Video title from Bilibili.
    pub title: String,
    /// Bilibili video URL.
    pub url: String,
    /// Download completion timestamp in ISO 8601 format.
    pub downloaded_at: String,
    /// Download status: "success" or "failed".
    pub status: String,
    /// Downloaded file size in bytes (optional).
    pub file_size: Option<u64>,
    /// Video quality (e.g., "1080P60", optional).
    pub quality: Option<String>,
    /// Thumbnail URL (NOT Base64 - URL only).
    pub thumbnail_url: Option<String>,
    /// Version for data migration support.
    #[serde(default = "default_version")]
    pub version: String,
}

/// Default version for new history entries.
fn default_version() -> String {
    "1.0".to_string()
}

/// Search filters for history queries.
///
/// Allows filtering by status, quality, date range, and text search.
#[derive(Debug, Clone, Default)]
pub struct HistoryFilters {
    /// Filter by download status.
    pub status: Option<String>,
    /// Filter by video quality.
    pub quality: Option<String>,
    /// Filter by date range start (ISO 8601).
    pub start_date: Option<String>,
    /// Filter by date range end (ISO 8601).
    pub end_date: Option<String>,
    /// Text search in title and URL.
    pub query: Option<String>,
}
