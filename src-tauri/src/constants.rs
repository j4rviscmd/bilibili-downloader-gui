//! Application Constants
//!
//! This module defines constant values used throughout the application,
//! particularly for HTTP requests to Bilibili APIs.

/// User-Agent header value for HTTP requests to Bilibili.
///
/// This mimics a common browser user-agent to ensure proper API access.
pub const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

/// Referer header value for HTTP requests to Bilibili.
///
/// Required by Bilibili's API for request validation.
pub const REFERER: &str = "https://www.bilibili.com";

/// Initial speed check size in bytes for detecting slow CDN nodes.
///
/// The first N bytes are used to measure download speed. If the speed
/// falls below `MIN_SPEED_THRESHOLD`, the connection will be dropped and
/// retried (up to `MAX_RECONNECT_ATTEMPTS` times) to get a different CDN node.
///
/// # Value
///
/// - **Default**: `1 * 1024 * 1024` (1 MiB)
/// - **Purpose**: Size of initial data sample used for speed measurement
pub const SPEED_CHECK_SIZE: u64 = 1024 * 1024; // 1 MiB

/// Minimum download speed threshold in bytes per second.
///
/// If the initial download speed is below this threshold, the connection
/// is considered slow and will be reconnected to attempt getting a faster
/// CDN node.
pub const MIN_SPEED_THRESHOLD: u64 = 3 * 1024 * 1024; // 3MB/s

/// Maximum number of reconnect attempts for slow connections.
///
/// When initial speed check fails (below MIN_SPEED_THRESHOLD), the system
/// will reconnect up to this many times. After exceeding this limit,
/// download continues even if slow to ensure completion.
pub const MAX_RECONNECT_ATTEMPTS: u8 = 2;
