//! Tauri Command Handlers
//!
//! Organized by functionality:
//! - **bilibili**: Video info retrieval and download operations
//! - **cleanup**: Orphaned temp file cleanup on app init
//! - **concurrency**: Semaphore management for parallel downloads
//! - **cookie**: Firefox cookie extraction and caching
//! - **favorites**: Bilibili favorite folder and video retrieval
//! - **ffmpeg**: Binary validation and installation, A/V merging
//! - **github**: GitHub API integration (repository info)
//! - **settings**: Application settings persistence
//! - **updater**: GitHub release notes fetching

pub mod bilibili;
pub mod cleanup;
pub mod concurrency;
pub mod cookie;
pub mod favorites;
pub mod ffmpeg;
pub mod github;
pub mod settings;
pub mod updater;
