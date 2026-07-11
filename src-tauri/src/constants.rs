//! Application Constants
//!
//! This module defines constant values used throughout the application,
//! particularly for HTTP requests to Bilibili APIs.

/// User-Agent header value for HTTP requests to Bilibili.
///
/// This mimics a common browser user-agent to ensure proper API access.
pub const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ",
    "AppleWebKit/537.36 (KHTML, like Gecko) ",
    "Chrome/120.0.0.0 Safari/537.36",
);

/// Referer header value for HTTP requests to Bilibili.
///
/// Required by Bilibili's API for request validation.
pub const REFERER: &str = "https://www.bilibili.com";

/// Minimum download speed threshold in bytes per second.
///
/// If the download speed is below this threshold for the configured interval,
/// the connection will be rotated to attempt getting a faster CDN node.
pub const MIN_SPEED_THRESHOLD: u64 = 1024 * 1024; // 1MB/s

/// Speed check interval in seconds.
///
/// Time between consecutive speed checks during download.
pub const SPEED_CHECK_INTERVAL_SECS: u64 = 3;

/// Minimum data required for speed calculation in bytes.
///
/// Ensures sufficient data for accurate speed measurement. Must accumulate
/// at least this much data between speed checks.
pub const MIN_DATA_FOR_SPEED_CHECK: u64 = 100 * 1024; // 100 KiB

/// Maximum number of CDN rotation loops.
///
/// Limits the number of times CDN nodes are rotated when slow speeds
/// are detected. Max is (number of CDN URLs) × MAX_CDN_LOOPS.
pub const MAX_CDN_LOOPS: u8 = 3;

/// Timeout in seconds for the ffmpeg functional validation probe.
///
/// The validation runs a tiny AAC encode to confirm the binary is not
/// partially corrupted. A generous timeout covers low-spec machines
/// where process spawn + codec init is slower; a hung ffmpeg (a symptom
/// of corruption) is treated as validation failure.
pub const FFMPEG_VALIDATION_TIMEOUT_SECS: u64 = 60;

/// Minimum byte threshold for media files.
///
/// Any downloaded media file smaller than this is treated as invalid
/// (likely an error page or API response instead of actual media).
/// This threshold catches cases where CDN/URL issues cause downloads
/// to return HTML/XML error pages masquerading as media files.
pub const MIN_MEDIA_BYTES: u64 = 1024; // 1 KiB
