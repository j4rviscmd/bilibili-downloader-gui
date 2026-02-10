//! Tauri Command Handlers
//!
//! Organized by functionality:
//! - **bilibili**: Video info retrieval and download operations
//! - **concurrency**: Semaphore management for parallel downloads
//! - **cookie**: Firefox cookie extraction and caching
//! - **ffmpeg**: Binary validation and installation, A/V merging
//! - **github**: GitHub API integration (repository info)
//! - **settings**: Application settings persistence
//! - **updater**: GitHub release notes fetching

pub mod bilibili;
pub mod concurrency;
pub mod cookie;
pub mod ffmpeg;
pub mod github;
pub mod settings;
pub mod updater;
