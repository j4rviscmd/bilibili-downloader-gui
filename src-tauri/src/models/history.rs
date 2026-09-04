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
    /// Download status: "in_progress", "completed", or "failed".
    pub status: String,
    /// Backend `ERR::*` code explaining why status is "failed"; the pseudo
    /// code `ERR::INTERRUPTED` marks entries whose owning process died
    /// before the download result settled (issue #511).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
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

// Why: HistoryEntry's camelCase JSON is also the on-disk format persisted to
// history.json (src-tauri/src/store/history_store.rs); renaming fields would
// orphan existing users' history files, so the wire names are pinned here.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_entry_roundtrips_camel_case() {
        let json = r#"{
            "id": "abc-1",
            "title": "【示例】動画",
            "bvid": "BV1h4y1w7h7",
            "url": "https://www.bilibili.com/video/BV1h4y1w7h7",
            "downloadedAt": "2026-08-24T10:00:00Z",
            "status": "completed",
            "fileSize": 123456789,
            "quality": "1080P60",
            "thumbnailUrl": "http://i0.hdslb.com/bfs/archive/thumb.jpg",
            "version": "1.0"
        }"#;
        let entry: HistoryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.id, "abc-1");
        assert_eq!(entry.bvid.as_deref(), Some("BV1h4y1w7h7"));
        assert_eq!(entry.file_size, Some(123456789));
        assert_eq!(entry.quality.as_deref(), Some("1080P60"));
        assert_eq!(entry.version, "1.0");

        let out = serde_json::to_value(&entry).unwrap();
        assert_eq!(out["downloadedAt"], "2026-08-24T10:00:00Z");
        assert_eq!(out["fileSize"], 123456789);
        assert_eq!(
            out["thumbnailUrl"],
            "http://i0.hdslb.com/bfs/archive/thumb.jpg"
        );
        assert_eq!(out["version"], "1.0");
        // errorMessage is omitted when None (on-disk format stays compact).
        assert!(out.get("errorMessage").is_none());
    }

    #[test]
    fn history_entry_roundtrips_error_message() {
        let json = r#"{
            "id": "err-1", "title": "t", "url": "u",
            "downloadedAt": "2026-09-01T00:00:00Z",
            "status": "failed",
            "errorMessage": "ERR::INTERRUPTED"
        }"#;
        let entry: HistoryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.error_message.as_deref(), Some("ERR::INTERRUPTED"));

        let out = serde_json::to_value(&entry).unwrap();
        assert_eq!(out["errorMessage"], "ERR::INTERRUPTED");

        // Legacy entries written before issue #511 deserialize without the
        // field (serde default -> None).
        let legacy: HistoryEntry = serde_json::from_str(
            r#"{
                "id": "old-1", "title": "t", "url": "u",
                "downloadedAt": "2026-08-01T00:00:00Z",
                "status": "completed"
            }"#,
        )
        .unwrap();
        assert!(legacy.error_message.is_none());
    }

    #[test]
    fn history_entry_defaults_and_omits() {
        // Legacy entries lack bvid and version (v1.0 migration path).
        let entry: HistoryEntry = serde_json::from_str(
            r#"{
                "id": "old-1", "title": "t",
                "url": "u", "downloadedAt": "2020-01-01T00:00:00Z",
                "status": "failed", "fileSize": null, "quality": null
            }"#,
        )
        .unwrap();
        assert!(entry.bvid.is_none());
        assert!(entry.thumbnail_url.is_none());
        assert_eq!(entry.version, "1.0", "missing version defaults to 1.0");

        let out = serde_json::to_string(&entry).unwrap();
        assert!(!out.contains("bvid"), "None bvid is skipped on serialize");
    }

    #[test]
    fn history_filters_skip_none_fields() {
        let filters = HistoryFilters::default();
        let out = serde_json::to_string(&filters).unwrap();
        assert_eq!(out, "{}", "all-None filters serialize to empty object");

        let filters = HistoryFilters {
            status: Some("completed".into()),
            date_from: Some("2026-01-01".into()),
        };
        let out = serde_json::to_value(&filters).unwrap();
        assert_eq!(out["status"], "completed");
        assert_eq!(out["dateFrom"], "2026-01-01");

        let back: HistoryFilters = serde_json::from_value(out).expect("roundtrip parses camelCase");
        assert_eq!(back.status.as_deref(), Some("completed"));
    }
}
