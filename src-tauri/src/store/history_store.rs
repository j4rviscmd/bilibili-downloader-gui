//! History Store
//!
//! This module provides persistent storage for download history using the
//! multi-process safe locked JSON helpers (`utils::locked_json`), with
//! versioning and entry-count capping (issue #560).
//!
//! The on-disk format is identical to the previous tauri-plugin-store layout
//! (`{"__version__": "1.0", "entries": [...]}`) and lives at the same
//! `app_data_dir/history.json` path, so existing data needs no migration.

use crate::models::history::{HistoryEntry, HistoryFilters};
use crate::utils::locked_json::{with_json, with_json_mut};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const VERSION_KEY: &str = "__version__";
const ENTRIES_KEY: &str = "entries";
const CURRENT_VERSION: &str = "1.0";

/// Upper bound on stored history entries (issue #560).
///
/// Why a cap: every write re-reads and re-serializes the whole file under the
/// lock; ~5.5 MB of JSON at 10k entries is still a few milliseconds, but the
/// list serves search only, so unbounded growth buys nothing.
const MAX_ENTRIES: usize = 10_000;

/// History store backed by `app_data_dir/history.json`.
///
/// All operations serialize through the inter-process file lock provided by
/// [`crate::utils::locked_json`], so two app instances writing simultaneously
/// (parallel downloads, issue #560) never lose entries. Reads always hit the
/// disk, so entries written by another process are visible immediately.
pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    /// Creates a handle to the history store.
    ///
    /// # Errors
    ///
    /// Returns an error if the app data directory cannot be resolved.
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let path = app.path().app_data_dir()?.join("history.json");
        Ok(Self::with_path(path))
    }

    /// Creates a handle to a history store at an explicit path.
    ///
    /// Test seam for the store logic itself (merge, cap, remove); production
    /// code goes through [`HistoryStore::new`].
    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    /// Deserializes the entries array from a store document.
    fn entries_from(value: &Value) -> Result<Vec<HistoryEntry>, String> {
        let entries_value = value.get(ENTRIES_KEY).cloned().unwrap_or_else(|| json!([]));
        serde_json::from_value(entries_value).map_err(|e| e.to_string())
    }

    /// Writes the entries array (plus version key) into a store document.
    fn set_entries(value: &mut Value, entries: &[HistoryEntry]) -> Result<(), String> {
        let entries_value = serde_json::to_value(entries).map_err(|e| e.to_string())?;
        value[VERSION_KEY] = json!(CURRENT_VERSION);
        value[ENTRIES_KEY] = entries_value;
        Ok(())
    }

    /// Loads all history entries from disk.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read or parsed.
    pub fn load(&self) -> Result<Vec<HistoryEntry>, String> {
        with_json(&self.path, |v| Self::entries_from(v)).map_err(|e| e.to_string())
    }

    /// Saves history entries with an atomic locked write.
    ///
    /// # Errors
    ///
    /// Returns an error if serialization or the locked write fails.
    pub fn save(&self, entries: &[HistoryEntry]) -> Result<(), String> {
        with_json_mut(&self.path, |v| Self::set_entries(v, entries)).map_err(|e| e.to_string())
    }

    /// Adds a single entry to the beginning of history (newest first).
    ///
    /// The read-insert-write sequence runs as one locked transaction: entries
    /// added by another process in the meantime are preserved, and the list is
    /// capped at [`MAX_ENTRIES`] (oldest beyond the cap are dropped).
    ///
    /// # Errors
    ///
    /// Returns an error if the locked read-modify-write fails.
    pub fn add_entry(&self, entry: HistoryEntry) -> Result<(), String> {
        with_json_mut(&self.path, |v| {
            let mut entries = Self::entries_from(v)?;
            entries.insert(0, entry);
            entries.truncate(MAX_ENTRIES);
            Self::set_entries(v, &entries)
        })
        .map_err(|e| e.to_string())
    }

    /// Removes an entry by ID.
    ///
    /// This operation is idempotent: removing a non-existent ID succeeds without error.
    ///
    /// # Errors
    ///
    /// Returns an error only if the locked read-modify-write fails.
    pub fn remove_entry(&self, id: &str) -> Result<(), String> {
        with_json_mut(&self.path, |v| {
            let mut entries = Self::entries_from(v)?;
            entries.retain(|e| e.id != id);
            Self::set_entries(v, &entries)
        })
        .map_err(|e| e.to_string())
    }

    /// Removes all history entries from the store.
    ///
    /// # Errors
    ///
    /// Returns an error if the locked write fails.
    pub fn clear(&self) -> Result<(), String> {
        with_json_mut(&self.path, |v| Self::set_entries(v, &[])).map_err(|e| e.to_string())
    }

    /// Retrieves all history entries from the store.
    ///
    /// If loading fails (e.g., corrupted data), it returns an empty vector
    /// instead of an error.
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

    fn store_in(dir: &std::path::Path) -> HistoryStore {
        HistoryStore::with_path(dir.join("history.json"))
    }

    fn store_entry(id: &str, title: &str, status: &str, downloaded_at: &str) -> HistoryEntry {
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
        let entries = vec![store_entry("a", "A", "completed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries.clone(), None, &HistoryFilters::default());
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn filter_entries_query_matches_title_or_url_case_insensitive() {
        let entries = vec![
            store_entry(
                "a",
                "【歌ってみた】Song Cover",
                "completed",
                "2026-01-01T00:00:00Z",
            ),
            store_entry("b", " unrelated", "completed", "2026-01-02T00:00:00Z"),
        ];
        let out = filter_entries(entries, Some("SONG"), &HistoryFilters::default());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "a");

        // URL match also hits
        let entries = vec![store_entry(
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
        let entries = vec![store_entry("a", "t", "completed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries, Some(""), &HistoryFilters::default());
        assert_eq!(out.len(), 1, "empty query must not filter anything out");
    }

    #[test]
    fn filter_entries_status_treats_legacy_success_as_completed() {
        let entries = vec![
            store_entry("old", "t", "success", "2026-01-01T00:00:00Z"),
            store_entry("new", "t", "completed", "2026-01-02T00:00:00Z"),
            store_entry("bad", "t", "failed", "2026-01-03T00:00:00Z"),
        ];
        let filters = HistoryFilters {
            status: Some("completed".into()),
            date_from: None,
        };
        let out = filter_entries(entries, None, &filters);
        let ids: Vec<&str> = out.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["old", "new"]);

        let entries = vec![store_entry("bad", "t", "failed", "2026-01-01T00:00:00Z")];
        let out = filter_entries(entries, None, &filters);
        assert!(out.is_empty());
    }

    #[test]
    fn filter_entries_status_all_keeps_everything() {
        let entries = vec![
            store_entry("a", "t", "completed", "2026-01-01T00:00:00Z"),
            store_entry("b", "t", "failed", "2026-01-02T00:00:00Z"),
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
            store_entry("old", "t", "completed", "2026-01-01T00:00:00Z"),
            store_entry("edge", "t", "completed", "2026-01-02T00:00:00Z"),
            store_entry("new", "t", "completed", "2026-01-03T00:00:00Z"),
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

    // ---- HistoryStore file-backed operations (fs, tempfile) ----

    #[test]
    fn add_entry_prepends_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        store
            .add_entry(store_entry("a", "A", "completed", "2026-01-01T00:00:00Z"))
            .unwrap();
        store
            .add_entry(store_entry("b", "B", "completed", "2026-01-02T00:00:00Z"))
            .unwrap();

        let all = store.get_all();
        let ids: Vec<&str> = all.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a"]);
    }

    #[test]
    fn add_entry_preserves_entries_written_by_another_process() {
        // The core #560 guarantee: a locked read-modify-write must not lose
        // entries another process wrote behind our back. Simulated here by
        // two independent store handles on the same file (with_json has no
        // in-process cache, so the second handle reads the first's writes).
        let dir = tempfile::tempdir().unwrap();
        let process_a = store_in(dir.path());
        let process_b = store_in(dir.path());

        process_a
            .add_entry(store_entry("a", "A", "completed", "2026-01-01T00:00:00Z"))
            .unwrap();
        process_b
            .add_entry(store_entry("b", "B", "completed", "2026-01-02T00:00:00Z"))
            .unwrap();

        let all = process_a.get_all();
        let ids: Vec<&str> = all.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["b", "a"],
            "no entry may be lost to last-write-wins"
        );
    }

    #[test]
    fn add_entry_caps_history_at_max_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        // Seed directly at the cap + 1 (fast path; adding 10k times through
        // the lock would be needlessly slow), then one more insert through
        // add_entry must drop the oldest beyond the cap.
        let mut entries: Vec<HistoryEntry> = (0..=MAX_ENTRIES as u32)
            .map(|i| store_entry(&format!("e{i}"), "t", "completed", "2026-01-01T00:00:00Z"))
            .collect();
        entries.reverse(); // oldest first so save keeps chronological order
        store.save(&entries).unwrap();
        assert_eq!(store.get_all().len(), MAX_ENTRIES + 1);

        store
            .add_entry(store_entry(
                "fresh",
                "t",
                "completed",
                "2026-02-01T00:00:00Z",
            ))
            .unwrap();

        let all = store.get_all();
        assert_eq!(all.len(), MAX_ENTRIES, "cap enforced on insert");
        assert_eq!(all[0].id, "fresh", "newest stays at the head");
        assert!(
            !all.iter().any(|e| e.id == "e0"),
            "oldest entry beyond the cap is dropped"
        );
    }

    #[test]
    fn remove_entry_is_idempotent_and_clear_empties() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store
            .add_entry(store_entry("a", "A", "completed", "2026-01-01T00:00:00Z"))
            .unwrap();
        store
            .add_entry(store_entry("b", "B", "completed", "2026-01-02T00:00:00Z"))
            .unwrap();

        store.remove_entry("a").unwrap();
        store.remove_entry("a").unwrap(); // non-existent: no error
        assert_eq!(store.get_all().len(), 1);

        store.clear().unwrap();
        assert!(store.get_all().is_empty());
    }

    #[test]
    fn on_disk_format_keeps_plugin_store_layout() {
        // Backward compatibility: files written by the old tauri-plugin-store
        // era (and read by future versions) keep the same shape and path
        // relative layout: {"__version__": "1.0", "entries": [...]}.
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store
            .add_entry(store_entry("a", "A", "completed", "2026-01-01T00:00:00Z"))
            .unwrap();

        let raw: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("history.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(raw["__version__"], "1.0");
        assert!(raw["entries"].is_array());
    }
}
