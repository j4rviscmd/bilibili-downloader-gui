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
