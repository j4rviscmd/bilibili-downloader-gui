//! Video Download Concurrency Control Module
//!
//! This module manages:
//! - Maximum concurrent video downloads (semaphore)
//! - Download cancellation tokens for aborting in-progress downloads

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

/// Default maximum number of concurrent video downloads.
const DEFAULT_MAX_CONCURRENT_DOWNLOADS: usize = 8;

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
pub static VIDEO_SEMAPHORE: Lazy<Arc<Semaphore>> =
    Lazy::new(|| Arc::new(Semaphore::new(DEFAULT_MAX_CONCURRENT_DOWNLOADS)));

/// Global registry for download cancellation tokens.
///
/// This registry maps download IDs to their corresponding cancellation tokens,
/// allowing the frontend to cancel in-progress downloads.
///
/// # Thread Safety
///
/// Uses `Arc<Mutex<HashMap>>` for thread-safe access from multiple download tasks.
///
/// # Lifecycle
///
/// 1. **Register**: Call `register()` when download starts
/// 2. **Cancel**: Call `cancel()` to signal cancellation
/// 3. **Remove**: Call `remove()` when download completes or is cancelled
pub static DOWNLOAD_CANCEL_REGISTRY: Lazy<Arc<DownloadCancelRegistry>> =
    Lazy::new(|| Arc::new(DownloadCancelRegistry::new()));

/// Registry for managing download cancellation tokens.
///
/// Each active download registers a `CancellationToken` that can be used
/// to signal cancellation. The token is stored until the download completes
/// or is explicitly removed.
#[derive(Debug, Default)]
pub struct DownloadCancelRegistry {
    /// Maps download ID to its cancellation token
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl DownloadCancelRegistry {
    /// Creates a new empty registry.
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a new cancellation token for a download.
    ///
    /// Returns the created token which should be used to check for cancellation.
    /// If a token already exists for this download ID, it is replaced.
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download
    ///
    /// # Returns
    ///
    /// The created `CancellationToken`
    pub async fn register(&self, download_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        let mut tokens = self.tokens.lock().await;
        tokens.insert(download_id.to_string(), token.clone());
        token
    }

    /// Signals cancellation for a specific download.
    ///
    /// Returns `true` if the download was found and cancelled, `false` otherwise.
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download to cancel
    ///
    /// # Returns
    ///
    /// `true` if cancellation was signaled, `false` if download not found
    pub async fn cancel(&self, download_id: &str) -> bool {
        let tokens = self.tokens.lock().await;
        if let Some(token) = tokens.get(download_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// Signals cancellation for all registered downloads.
    ///
    /// Returns the number of downloads that were cancelled.
    ///
    /// # Returns
    ///
    /// Number of downloads cancelled
    pub async fn cancel_all(&self) -> usize {
        let tokens = self.tokens.lock().await;
        let count = tokens.len();
        for token in tokens.values() {
            token.cancel();
        }
        count
    }

    /// Removes a download's cancellation token from the registry.
    ///
    /// Should be called when a download completes (successfully or with error)
    /// to clean up the registry.
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download to remove
    pub async fn remove(&self, download_id: &str) {
        let mut tokens = self.tokens.lock().await;
        tokens.remove(download_id);
    }

    /// Checks if a download is registered (for debugging).
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download
    ///
    /// # Returns
    ///
    /// `true` if the download is registered, `false` otherwise
    #[allow(dead_code)]
    pub async fn is_registered(&self, download_id: &str) -> bool {
        let tokens = self.tokens.lock().await;
        tokens.contains_key(download_id)
    }

    /// Gets a clone of the cancellation token for a specific download.
    ///
    /// Returns `None` if the download is not registered.
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download
    ///
    /// # Returns
    ///
    /// `Some(token)` if found, `None` otherwise
    pub async fn get_token(&self, download_id: &str) -> Option<CancellationToken> {
        let tokens = self.tokens.lock().await;
        tokens.get(download_id).cloned()
    }

    /// Gets all registered download IDs.
    ///
    /// # Returns
    ///
    /// Vector of all registered download IDs
    pub async fn get_all_ids(&self) -> Vec<String> {
        let tokens = self.tokens.lock().await;
        tokens.keys().cloned().collect()
    }
}
