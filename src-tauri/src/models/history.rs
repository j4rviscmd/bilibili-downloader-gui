//! Download history model.
//!
//! This module defines the HistoryEntry structure for tracking downloaded videos
//! in persistent storage.

use serde::{Deserialize, Serialize};

/// A download history entry.
///
/// Represents a single downloaded video record with metadata for history
/// tracking and search functionality.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// Unique identifier for the history entry.
    pub id: String,
    /// Video title fetched from Bilibili.
    pub title: String,
    /// Bilibili video ID (BV identifier, optional for backward compatibility).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bvid: Option<String>,
    /// Bilibili video URL.
    pub url: String,
    /// Download completion timestamp (ISO 8601 format).
    pub downloaded_at: String,
    /// Download status: "completed" or "failed".
    pub status: String,
    /// Downloaded file size in bytes (optional).
    pub file_size: Option<u64>,
    /// Video quality (e.g., "1080P60", optional).
    pub quality: Option<String>,
    /// Thumbnail URL (original Bilibili URL).
    /// Frontend fetches and converts to base64 on-demand via API.
    pub thumbnail_url: Option<String>,
    /// Version for data migration support.
    #[serde(default = "default_version")]
    pub version: String,
}

/// Returns the default version string for new history entries.
fn default_version() -> String {
    "1.0".to_string()
}

/// Filter for history search.
///
/// Supports filtering by status, date range, and text search.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilters {
    /// Filter by download status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Filter by date range start (ISO 8601 format).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_from: Option<String>,
}
