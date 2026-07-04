//! Tauri Command Handlers
//!
//! Organized by functionality:
//! - **bilibili**: Video info retrieval and download operations
//! - **cleanup**: Orphaned temp file cleanup on app init
//! - **concurrency**: Semaphore management for parallel downloads
//! - **concat**: Local MP4 file concatenation via ffmpeg concat demuxer
//! - **cookie**: Firefox cookie extraction and caching
//! - **favorites**: Bilibili favorite folder and video retrieval
//! - **ffmpeg**: Binary validation and installation, A/V merging
//! - **github**: GitHub API integration (repository info)
//! - **settings**: Application settings persistence
//! - **trim**: Local MP4 file trimming via ffmpeg stream copy
//! - **updater**: GitHub release notes fetching

pub mod audio;
pub mod bilibili;
pub mod cleanup;
pub mod concat;
pub mod concurrency;
pub mod cookie;
pub mod favorites;
pub mod ffmpeg;
pub mod github;
pub mod qr_login;
pub mod resolution;
pub mod settings;
pub mod trim;
pub mod updater;
