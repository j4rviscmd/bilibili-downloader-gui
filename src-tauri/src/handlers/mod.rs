//! Tauri Command Handlers
//!
//! This module contains implementation of all Tauri commands,
//! organized by functionality.
//!
//! ## Submodules
//!
//! - **bilibili**: Video info retrieval and download operations
//! - **concurrency**: Semaphore management for parallel downloads
//! - **cookie**: Firefox cookie extraction and caching
//! - **ffmpeg**: Binary validation and installation, A/V merging
//! - **settings**: Application settings persistence

pub mod bilibili;
pub mod concurrency;
pub mod cookie;
pub mod ffmpeg;
pub mod settings;
