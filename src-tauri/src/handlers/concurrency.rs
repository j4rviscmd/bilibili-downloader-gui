//! Video Download Concurrency Control Module
//!
//! This module manages the maximum number of concurrent video downloads to prevent
//! overload of network and system resources.

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Global semaphore limiting concurrent video downloads.
///
/// This semaphore controls how many video files can be downloaded simultaneously.
/// The default limit allows 8 concurrent downloads. Audio downloads are not
/// limited by this semaphore.
///
/// # Semaphore Lifecycle
///
/// The semaphore follows this lifecycle:
///
/// 1. **Acquire**: Call `acquire_owned()` before download starts
/// 2. **Hold**: Keep permit held during download and merge
/// 3. **Release**: Call `drop()` after merge completes
///
/// This design ensures the semaphore limits concurrency based on "merge processing
/// CPU/disk load" rather than "network bandwidth".
///
/// # Example
///
/// ```rust
/// use crate::handlers::concurrency::VIDEO_SEMAPHORE;
///
/// // Acquire semaphore (async)
/// let permit = VIDEO_SEMAPHORE.clone().acquire_owned().await?;
///
/// // Download and merge processing
/// // ...
///
/// // Release semaphore
/// drop(permit);
/// ```
pub static VIDEO_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(8)));
