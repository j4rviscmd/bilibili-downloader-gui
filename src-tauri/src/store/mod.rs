//! Storage modules
//!
//! This module contains persistent storage implementations backed by the
//! multi-process safe locked JSON helpers (`utils::locked_json`).

pub mod history_store;
pub mod search_history_store;

pub use history_store::HistoryStore;
pub use search_history_store::SearchHistoryStore;
