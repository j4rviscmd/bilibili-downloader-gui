//! Search history model.
//!
//! A single recorded search keyword with recency/reuse counters, persisted to
//! `app_data_dir/search_history.json` (src-tauri/src/store/search_history_store.rs).

use serde::{Deserialize, Serialize};

/// A search-history entry.
///
/// Why camelCase: this struct's JSON is both the on-disk format of
/// `search_history.json` and the wire format of the `get_search_history`
/// command — same pinning convention as `models::history::HistoryEntry`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryEntry {
    /// The search keyword as submitted (trimmed).
    pub keyword: String,
    /// Last-searched timestamp (ISO 8601, UTC).
    pub searched_at: String,
    /// How many times this keyword was searched (1 on first record).
    #[serde(default = "default_use_count")]
    pub use_count: u32,
}

/// Default for entries written before `useCount` existed.
fn default_use_count() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_history_entry_roundtrips_camel_case() {
        let json = r#"{
            "keyword": "洛天依",
            "searchedAt": "2026-10-05T12:00:00Z",
            "useCount": 3
        }"#;
        let entry: SearchHistoryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.keyword, "洛天依");
        assert_eq!(entry.use_count, 3);
        let back = serde_json::to_value(&entry).unwrap();
        assert_eq!(back["searchedAt"], "2026-10-05T12:00:00Z");
    }

    #[test]
    fn search_history_entry_defaults_missing_use_count() {
        let entry: SearchHistoryEntry =
            serde_json::from_str(r#"{"keyword":"k","searchedAt":"t"}"#).unwrap();
        assert_eq!(entry.use_count, 1);
    }
}
