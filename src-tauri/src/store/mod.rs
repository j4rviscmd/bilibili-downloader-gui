//! Storage modules
//!
//! This module contains persistent storage implementations using
//! tauri-plugin-store for various data types.

pub mod history_store;

pub use history_store::HistoryStore;
