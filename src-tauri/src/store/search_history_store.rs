//! Search History Store
//!
//! Persistent storage for the video-search keyword history, using the
//! multi-process safe locked JSON helpers (`utils::locked_json`). Follows the
//! same layout/conventions as the download-history store
//! (src-tauri/src/store/history_store.rs) minus its legacy `__version__` key:
//! this file is new, so there is no on-disk format to stay compatible with.
//!
//! On-disk format: `{ "entries": [ { "keyword", "searchedAt", "useCount" } ] }`

use crate::models::search_history::SearchHistoryEntry;
use crate::utils::locked_json::{with_json, with_json_mut};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const ENTRIES_KEY: &str = "entries";

/// Upper bound on stored keywords (matches the panel display size; the list
/// exists only to pre-fill the empty-input suggest dropdown).
const MAX_ENTRIES: usize = 10;

/// Search-history store backed by `app_data_dir/search_history.json`.
///
/// All operations serialize through the inter-process file lock provided by
/// [`crate::utils::locked_json`], so two app instances recording searches
/// simultaneously never lose entries (same guarantee as the download store).
pub struct SearchHistoryStore {
    path: PathBuf,
}

impl SearchHistoryStore {
    /// Creates a handle to the store.
    ///
    /// # Errors
    ///
    /// Returns an error if the app data directory cannot be resolved.
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let path = app.path().app_data_dir()?.join("search_history.json");
        Ok(Self::with_path(path))
    }

    /// Creates a handle to a store at an explicit path.
    ///
    /// Test seam for the store logic itself (record/merge/cap/remove);
    /// production code goes through [`SearchHistoryStore::new`].
    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    /// Deserializes the entries array from a store document.
    fn entries_from(value: &Value) -> Result<Vec<SearchHistoryEntry>, String> {
        let entries_value = value.get(ENTRIES_KEY).cloned().unwrap_or_else(|| json!([]));
        serde_json::from_value(entries_value).map_err(|e| e.to_string())
    }

    /// Writes the entries array into a store document.
    fn set_entries(value: &mut Value, entries: &[SearchHistoryEntry]) -> Result<(), String> {
        let entries_value = serde_json::to_value(entries).map_err(|e| e.to_string())?;
        value[ENTRIES_KEY] = entries_value;
        Ok(())
    }

    /// Loads all entries from disk.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read or parsed.
    pub fn load(&self) -> Result<Vec<SearchHistoryEntry>, String> {
        with_json(&self.path, Self::entries_from).map_err(|e| e.to_string())
    }

    /// Records a keyword: moves it to the front, bumps `useCount` (or starts
    /// it at 1), stamps `searchedAt`, and caps the list at [`MAX_ENTRIES`].
    ///
    /// The read-modify-write runs as one locked transaction, so searches
    /// recorded by another process in the meantime are preserved.
    ///
    /// # Errors
    ///
    /// Returns an error only if the locked read-modify-write fails.
    pub fn record(&self, keyword: &str, searched_at: &str) -> Result<(), String> {
        with_json_mut(&self.path, |v| {
            let mut entries = Self::entries_from(v)?;
            let use_count = entries
                .iter()
                .find(|e| e.keyword == keyword)
                .map(|e| e.use_count.saturating_add(1))
                .unwrap_or(1);
            entries.retain(|e| e.keyword != keyword);
            entries.insert(
                0,
                SearchHistoryEntry {
                    keyword: keyword.to_string(),
                    searched_at: searched_at.to_string(),
                    use_count,
                },
            );
            entries.truncate(MAX_ENTRIES);
            Self::set_entries(v, &entries)
        })
        .map_err(|e| e.to_string())
    }

    /// Removes an entry by keyword (exact match). Idempotent.
    ///
    /// # Errors
    ///
    /// Returns an error only if the locked read-modify-write fails.
    pub fn remove(&self, keyword: &str) -> Result<(), String> {
        with_json_mut(&self.path, |v| {
            let mut entries = Self::entries_from(v)?;
            entries.retain(|e| e.keyword != keyword);
            Self::set_entries(v, &entries)
        })
        .map_err(|e| e.to_string())
    }

    /// Removes all entries.
    ///
    /// # Errors
    ///
    /// Returns an error if the locked write fails.
    pub fn clear(&self) -> Result<(), String> {
        with_json_mut(&self.path, |v| Self::set_entries(v, &[])).map_err(|e| e.to_string())
    }

    /// Retrieves all entries; a failed load (e.g. corrupted file) degrades to
    /// an empty vector instead of an error — history is non-critical.
    pub fn get_all(&self) -> Vec<SearchHistoryEntry> {
        self.load().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &std::path::Path) -> SearchHistoryStore {
        SearchHistoryStore::with_path(dir.join("search_history.json"))
    }

    #[test]
    fn record_inserts_newest_first_and_caps_at_max() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        for i in 0..(MAX_ENTRIES + 3) {
            store
                .record(&format!("kw{i}"), "2026-10-05T00:00:00Z")
                .unwrap();
        }
        let entries = store.load().unwrap();
        assert_eq!(entries.len(), MAX_ENTRIES);
        // Newest first: kw12 was recorded last.
        assert_eq!(entries[0].keyword, "kw12");
        // Oldest beyond the cap were dropped.
        assert!(!entries.iter().any(|e| e.keyword == "kw0"));
    }

    #[test]
    fn record_moves_duplicate_to_front_and_bumps_use_count() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.record("a", "t1").unwrap();
        store.record("b", "t2").unwrap();
        store.record("a", "t3").unwrap();

        let entries = store.load().unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|e| e.keyword.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(entries[0].use_count, 2);
        assert_eq!(entries[0].searched_at, "t3");
        assert_eq!(entries[1].use_count, 1);
    }

    #[test]
    fn remove_is_idempotent_for_missing_keyword() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.record("a", "t1").unwrap();
        store.remove("missing").unwrap();
        assert_eq!(store.load().unwrap().len(), 1);
        store.remove("a").unwrap();
        assert!(store.load().unwrap().is_empty());
    }

    #[test]
    fn clear_empties_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.record("a", "t1").unwrap();
        store.clear().unwrap();
        assert!(store.load().unwrap().is_empty());
        // On-disk shape: entries array present, no legacy version key.
        let raw: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("search_history.json")).unwrap(),
        )
        .unwrap();
        assert!(raw["entries"].is_array());
        assert!(raw.get("__version__").is_none());
    }

    #[test]
    fn get_all_degrades_corrupted_file_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search_history.json");
        std::fs::write(&path, "{not json").unwrap();
        assert!(store_in(dir.path()).get_all().is_empty());
    }

    #[test]
    fn record_saturates_use_count_at_u32_max() {
        // A legacy entry already at u32::MAX: re-recording must saturate,
        // not overflow/panic.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search_history.json");
        std::fs::write(
            &path,
            serde_json::json!({
                "entries": [
                    {"keyword": "k", "searchedAt": "t", "useCount": u32::MAX}
                ]
            })
            .to_string(),
        )
        .unwrap();
        let store = SearchHistoryStore::with_path(path);
        store.record("k", "t2").unwrap();
        let entries = store.load().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].use_count, u32::MAX);
        assert_eq!(entries[0].searched_at, "t2");
    }
}
