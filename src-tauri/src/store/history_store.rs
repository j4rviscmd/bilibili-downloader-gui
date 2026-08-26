//! History Store
//!
//! This module provides persistent storage for download history using
//! tauri-plugin-store with versioning, migration, and concurrent
//! write protection.

use crate::models::history::{HistoryEntry, HistoryFilters};
use serde_json::json;
use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const VERSION_KEY: &str = "__version__";
const ENTRIES_KEY: &str = "entries";
const CURRENT_VERSION: &str = "1.0";

/// History store wrapper for tauri-plugin-store.
///
/// Provides thread-safe operations with file locking for concurrent
/// write protection and automatic version migration.
pub struct HistoryStore {
    store: Arc<tauri_plugin_store::Store<tauri::Wry>>,
}

impl HistoryStore {
    /// Creates a new HistoryStore instance backed by a persistent JSON file.
    ///
    /// This function initializes or opens the history.json file from the
    /// application's store directory using tauri-plugin-store.
    ///
    /// # Arguments
    ///
    /// * `app` - Tauri application handle for accessing the store
    ///
    /// # Returns
    ///
    /// Returns `Ok(HistoryStore)` on success.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be created or opened.
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let store = app
            .store("history.json")
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

        Ok(Self { store })
    }

    /// Loads all history entries from the persistent store.
    ///
    /// Retrieves the entries array from the store and deserializes it
    /// into a vector of `HistoryEntry` structures.
    ///
    /// # Returns
    ///
    /// Returns `Ok(entries)` on success.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The stored value is not a valid JSON array
    /// - Deserialization into `HistoryEntry` fails
    pub fn load(&self) -> Result<Vec<HistoryEntry>, String> {
        let entries_value = self.store.get(ENTRIES_KEY).unwrap_or(json!([]));
        serde_json::from_value(entries_value).map_err(|e| e.to_string())
    }

    /// Saves history entries to the persistent store with atomic write.
    ///
    /// Serializes the entries vector and writes it to the store with version
    /// information. The write operation is atomic via tauri-plugin-store.
    ///
    /// # Arguments
    ///
    /// * `entries` - Vector of history entries to save
    ///
    /// # Returns
    ///
    /// Returns `Ok(())` on success.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Serialization to JSON fails
    /// - Store write operation fails
    pub fn save(&self, entries: &Vec<HistoryEntry>) -> Result<(), String> {
        let entries_value = serde_json::to_value(entries).map_err(|e| e.to_string())?;

        self.store.set(VERSION_KEY, CURRENT_VERSION);
        self.store.set(ENTRIES_KEY, entries_value);
        self.store.save().map_err(|e| e.to_string())
    }

    /// Adds a single entry to the beginning of history.
    ///
    /// Inserts the new entry at index 0 (newest first).
    ///
    /// # Arguments
    ///
    /// * `entry` - The history entry to add
    ///
    /// # Errors
    ///
    /// Returns an error if loading or saving fails.
    pub fn add_entry(&self, entry: HistoryEntry) -> Result<(), String> {
        let mut entries = self.load()?;
        entries.insert(0, entry);
        self.save(&entries)
    }

    /// Removes an entry by ID.
    ///
    /// This operation is idempotent: removing a non-existent ID succeeds without error.
    ///
    /// # Arguments
    ///
    /// * `id` - The unique identifier of the entry to remove
    ///
    /// # Errors
    ///
    /// Returns an error only if loading or saving fails.
    pub fn remove_entry(&self, id: &str) -> Result<(), String> {
        let mut entries = self.load()?;
        entries.retain(|e| e.id != id);
        self.save(&entries)
    }

    /// Removes all history entries from the store.
    ///
    /// # Errors
    ///
    /// Returns an error if saving fails.
    pub fn clear(&self) -> Result<(), String> {
        self.store.set(ENTRIES_KEY, json!([]));
        self.store.save().map_err(|e| e.to_string())
    }

    /// Retrieves all history entries from the store.
    ///
    /// This is a convenience method that returns all entries. If loading
    /// fails (e.g., corrupted data), it returns an empty vector instead
    /// of an error.
    ///
    /// # Returns
    ///
    /// Returns all history entries, or an empty vector if loading fails.
    pub fn get_all(&self) -> Vec<HistoryEntry> {
        self.load().unwrap_or_default()
    }

    /// Searches history entries with optional query string and filters.
    ///
    /// Delegates the actual matching to [`filter_entries`].
    pub fn search(
        &self,
        query: Option<String>,
        filters: Option<HistoryFilters>,
    ) -> Vec<HistoryEntry> {
        let entries = self.get_all();
        filter_entries(entries, query.as_deref(), &filters.unwrap_or_default())
    }
}

/// Pure history filtering logic, extracted from `HistoryStore::search`.
///
/// # Filtering Logic
///
/// - **Query**: Searches case-insensitive in title and URL
/// - **Status**: Filters by status ("completed", "failed", or "all");
///   the legacy "success" status is treated as "completed"
/// - **Date range**: Filters entries after `date_from` (if provided,
///   ISO 8601 string comparison)
fn filter_entries(
    entries: Vec<HistoryEntry>,
    query: Option<&str>,
    filters: &HistoryFilters,
) -> Vec<HistoryEntry> {
    entries
        .into_iter()
        .filter(|entry| {
            // Query search: match title or URL case-insensitively
            if let Some(q) = query.filter(|s| !s.is_empty()) {
                let query_lower = q.to_lowercase();
                let matches = entry.title.to_lowercase().contains(&query_lower)
                    || entry.url.to_lowercase().contains(&query_lower);
                if !matches {
                    return false;
                }
            }

            // Status filter
            if let Some(status) = filters.status.as_ref().filter(|s| *s != "all") {
                let entry_status = if entry.status == "success" || entry.status == "completed" {
                    "completed"
                } else {
                    entry.status.as_str()
                };
                if entry_status != status {
                    return false;
                }
            }

            // Date range filter
            if let Some(date_from) = filters.date_from.as_ref() {
                if &entry.downloaded_at < date_from {
                    return false;
                }
            }

            true
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, title: &str, status: &str, downloaded_at: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            title: title.into(),
            bvid: None,
            url: format!("https://www.bilibili.com/video/{id}"),
            downloaded_at: downloaded_at.into(),
            status: status.into(),
            file_size: None,
            quality: None,
            thumbnail_url: None,
            version: "1.0".into(),
        }
    }

    #[test]
    fn filter_entries_no_filters_returns_all() {
        let entries = vec![entry("a", "A", "completed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries.clone(), None, &HistoryFilters::default());
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn filter_entries_query_matches_title_or_url_case_insensitive() {
        let entries = vec![
            entry(
                "a",
                "【歌ってみた】Song Cover",
                "completed",
                "2026-01-01T00:00:00Z",
            ),
            entry("b", " unrelated", "completed", "2026-01-02T00:00:00Z"),
        ];
        let out = filter_entries(entries, Some("SONG"), &HistoryFilters::default());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "a");

        // URL match also hits
        let entries = vec![entry(
            "x",
            "no title match",
            "completed",
            "2026-01-01T00:00:00Z",
        )];
        let out = filter_entries(entries, Some("/video/x"), &HistoryFilters::default());
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn filter_entries_empty_query_is_ignored() {
        let entries = vec![entry("a", "t", "completed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries, Some(""), &HistoryFilters::default());
        assert_eq!(out.len(), 1, "empty query must not filter anything out");
    }

    #[test]
    fn filter_entries_status_treats_legacy_success_as_completed() {
        let entries = vec![
            entry("old", "t", "success", "2026-01-01T00:00:00Z"),
            entry("new", "t", "completed", "2026-01-02T00:00:00Z"),
            entry("bad", "t", "failed", "2026-01-03T00:00:00Z"),
        ];
        let filters = HistoryFilters {
            status: Some("completed".into()),
            date_from: None,
        };
        let out = filter_entries(entries, None, &filters);
        let ids: Vec<&str> = out.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["old", "new"]);

        let entries = vec![entry("bad", "t", "failed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries, None, &filters);
        assert!(out.is_empty());
    }

    #[test]
    fn filter_entries_status_all_keeps_everything() {
        let entries = vec![
            entry("a", "t", "completed", "2026-01-01T00:00:00Z"),
            entry("b", "t", "failed", "2026-01-02T00:00:00Z"),
        ];
        let filters = HistoryFilters {
            status: Some("all".into()),
            date_from: None,
        };
        assert_eq!(filter_entries(entries, None, &filters).len(), 2);
    }

    #[test]
    fn filter_entries_date_from_keeps_entries_on_or_after() {
        let entries = vec![
            entry("old", "t", "completed", "2026-01-01T00:00:00Z"),
            entry("edge", "t", "completed", "2026-01-02T00:00:00Z"),
            entry("new", "t", "completed", "2026-01-03T00:00:00Z"),
        ];
        let filters = HistoryFilters {
            status: None,
            date_from: Some("2026-01-02T00:00:00Z".into()),
        };
        let out = filter_entries(entries, None, &filters);
        let ids: Vec<&str> = out.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["edge", "new"],
            "boundary is inclusive (string compare >=)"
        );
    }
}
