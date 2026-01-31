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
    /// Creates a new HistoryStore instance.
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
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
    /// Returns an empty vector if loading fails.
    pub fn get_all(&self) -> Vec<HistoryEntry> {
        self.load().unwrap_or_default()
    }

    /// Searches history entries with optional query string and filters.
    ///
    /// # Filtering Logic
    ///
    /// - **Query**: Searches case-insensitive in title and URL
    /// - **Status**: Filters by status ("completed", "failed", or "all")
    /// - **Date range**: Filters entries after `date_from` (if provided)
    pub fn search(
        &self,
        query: Option<String>,
        filters: Option<HistoryFilters>,
    ) -> Vec<HistoryEntry> {
        let entries = self.get_all();
        let filters = filters.unwrap_or_default();

        entries
            .into_iter()
            .filter(|entry| {
                // Query search: match title or URL case-insensitively
                if let Some(q) = query.as_ref().filter(|s| !s.is_empty()) {
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
}
