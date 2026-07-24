//! Utility Modules
//!
//! This module contains utility functions for downloads, path resolution,
//! analytics (currently disabled), WBI signature generation, subtitle conversion,
//! filename sanitization, error handling, and log cleanup.

pub mod analytics;
pub mod cdn_selector;
pub mod codec;
pub mod downloads;
pub mod error_handler;
pub mod ffmpeg_probe;
pub mod ffmpeg_progress;
pub mod log_cleanup;
pub mod paths;
pub mod sanitize;
pub mod secure_storage;
pub mod subtitle;
pub mod wbi;
