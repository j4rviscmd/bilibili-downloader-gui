//! Concurrency Control for Video Downloads
//!
//! This module manages the maximum number of concurrent video downloads
//! to prevent overwhelming the network or system resources.

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Global semaphore limiting concurrent video downloads.
///
/// This semaphore controls how many video files can be downloaded simultaneously.
/// The default limit is 8 concurrent downloads. Audio downloads are not limited
/// by this semaphore.
pub static VIDEO_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(8)));
