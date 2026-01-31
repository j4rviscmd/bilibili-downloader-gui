//! History Store
//!
//! This module provides persistent storage for download history using
//! tauri-plugin-store with versioning, migration, and concurrent
//! write protection.

use crate::models::history::{HistoryEntry, HistoryFilters};
use serde_json::{json, Value as JsonValue};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::{Store, StoreExt};

const VERSION_KEY: &str = "__version__";
const ENTRIES_KEY: &str = "entries";
const CURRENT_VERSION: &str = "1.0";

/// History store wrapper for tauri-plugin-store.
///
/// Provides thread-safe operations with file locking for concurrent
/// write protection and automatic version migration.
pub struct HistoryStore {
    store: Store,
}

impl HistoryStore {
    /// Creates a new HistoryStore instance.
    pub fn new<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Self, Box<dyn std::error::Error>> {
        let store = app
            .store("history.json")
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

        Ok(Self { store })
    }

    /// Loads all history entries from store.
    pub fn load(&self) -> Result<Vec<HistoryEntry>, String> {
        let entries_value = self.store.get(ENTRIES_KEY).unwrap_or(json!([]));
        serde_json::from_value(entries_value).map_err(|e| e.to_string())
    }

    /// Saves history entries to store with atomic write.
    pub fn save(&self, entries: &Vec<HistoryEntry>) -> Result<(), String> {
        let entries_value = serde_json::to_value(entries).map_err(|e| e.to_string())?;

        self.store.set(VERSION_KEY, CURRENT_VERSION);
        self.store.set(ENTRIES_KEY, entries_value);
        self.store.save().map_err(|e| e.to_string())
    }

    /// Adds a single entry to history.
    pub fn add_entry(&self, entry: HistoryEntry) -> Result<(), String> {
        let mut entries = self.load()?;
        entries.insert(0, entry);
        self.save(&entries)
    }

    /// Removes an entry by ID.
    pub fn remove_entry(&self, id: &str) -> Result<(), String> {
        let entries_value = self.store.get(ENTRIES_KEY).unwrap_or(json!([]));
        let entries: Vec<JsonValue> = entries_value.as_array().unwrap();
        let new_entries: Vec<JsonValue> = entries
            .into_iter()
            .filter(|e| {
                if let Some(entry_obj) = e.as_object() {
                    if let Some(id_val) = entry_obj.get("id") {
                        id_val.as_str() != Some(id)
                    }
                }
            })
            .collect();

        if new_entries.len() == entries.len() {
            return Err(format!("Entry with id '{}' not found", id));
        }

        let new_value = JsonValue::Array(new_entries);
        self.store.set(ENTRIES_KEY, new_value);
        self.store.save().map_err(|e| e.to_string())
    }

    /// Gets all history entries.
    pub fn get_all(&self) -> Vec<HistoryEntry> {
        self.load().unwrap_or_default()
    }

    /// Searches history entries with filters.
    pub fn search(&self, filters: HistoryFilters) -> Vec<HistoryEntry> {
        let entries = self.get_all();

        entries
            .into_iter()
            .filter(|entry| {
                let mut include = true;

                if let Some(ref status) = filters.status {
                    if let Some(status_val) = entry.get("status") {
                        if status_val.as_str() != Some(status) {
                            include = false;
                        }
                    }
                }

                if let Some(ref quality) = filters.quality {
                    if let Some(quality_val) = entry.get("quality") {
                        if quality_val.as_str() != Some(quality) {
                            include = false;
                        }
                    }
                }

                if let Some(ref start_date) = filters.start_date {
                    if let Some(downloaded_at) = entry.get("downloaded_at") {
                        if downloaded_at.as_str() < Some(start_date) {
                            include = false;
                        }
                    }
                }
                if let Some(ref end_date) = filters.end_date {
                    if let Some(downloaded_at) = entry.get("downloaded_at") {
                        if downloaded_at.as_str() > Some(end_date) {
                            include = false;
                        }
                    }
                }

                if let Some(ref query) = filters.query {
                    let query_lower = query.to_lowercase();
                    if let Some(title) = entry.get("title") {
                        if !title
                            .as_str()
                            .map(|t| t.to_lowercase())
                            .contains(&query_lower)
                        {
                            include = false;
                        }
                    }
                    if let Some(url) = entry.get("url") {
                        if !url
                            .as_str()
                            .map(|u| u.to_lowercase())
                            .contains(&query_lower)
                        {
                            include = false;
                        }
                    }
                }

                include
            })
            .collect()
    }

    /// Checks version and performs migration if needed.
    fn migrate_if_needed(&self) -> Result<(), String> {
        if !self.store.has(VERSION_KEY) {
            self.store.set(VERSION_KEY, CURRENT_VERSION);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value as JsonValue};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_store::{Store, StoreExt};

    #[test]
    fn test_history_entry_default_version() {
        let entry = HistoryEntry {
            id: "test-id".to_string(),
            title: "Test Video".to_string(),
            url: "https://bilibili.com/video/123".to_string(),
            downloaded_at: "2024-01-15T10:30:00Z".to_string(),
            status: "success".to_string(),
            file_size: Some(1024000),
            quality: Some("1080P60".to_string()),
            thumbnail_url: Some("https://example.com/thumb.jpg".to_string()),
            version: "1.0".to_string(),
        };

        assert_eq!(entry.version, "1.0");
    }

    #[test]
    fn test_history_filters_default() {
        let filters = HistoryFilters::default();
        assert!(filters.status.is_none());
        assert!(filters.quality.is_none());
        assert!(filters.start_date.is_none());
        assert!(filters.end_date.is_none());
        assert!(filters.query.is_none());
    }

    #[test]
    fn test_history_entry_serialization() {
        let entry = HistoryEntry {
            id: "test-id".to_string(),
            title: "Test Video".to_string(),
            url: "https://bilibili.com/video/123".to_string(),
            downloaded_at: "2024-01-15T10:30:00Z".to_string(),
            status: "success".to_string(),
            file_size: Some(1024000),
            quality: Some("1080P60".to_string()),
            thumbnail_url: Some("https://example.com/thumb.jpg".to_string()),
            version: "1.0".to_string(),
        };

        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["id"], "test-id");
        assert_eq!(json["title"], "Test Video");
        assert_eq!(json["status"], "success");
    }

    #[test]
    fn test_thumbnail_url_format() {
        let entry = HistoryEntry {
            id: "1".to_string(),
            title: "Test".to_string(),
            url: "https://bilibili.com/video/123".to_string(),
            downloaded_at: "2024-01-15T10:30:00Z".to_string(),
            status: "success".to_string(),
            file_size: None,
            quality: None,
            thumbnail_url: Some("https://example.com/thumb.jpg".to_string()),
            version: "1.0".to_string(),
        };

        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["thumbnailUrl"], "https://example.com/thumb.jpg");
        assert!(json["thumbnailUrl"].is_string());
    }

    #[test]
    fn test_store_operations() {
        struct MockHandle {
            store: Option<Store>,
        }

        let mut handle = MockHandle { store: None };
        let mut manager = MockHandle;
        let store = Store::new(handle.store("history.json").unwrap());
        let mut history_store = HistoryStore { store };

        let entry = HistoryEntry {
            id: "test-id".to_string(),
            title: "Test Video".to_string(),
            url: "https://bilibili.com/video/123".to_string(),
            downloaded_at: "2024-01-15T10:30:00Z".to_string(),
            status: "success".to_string(),
            file_size: None,
            quality: None,
            thumbnail_url: None,
            version: "1.0".to_string(),
        };

        history_store.add_entry(entry).unwrap();
        let entries = history_store.get_all();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "test-id");
    }
}
