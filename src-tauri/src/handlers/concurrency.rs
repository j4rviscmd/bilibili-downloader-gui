//! Video Download Concurrency Control Module
//!
//! This module manages:
//! - Maximum concurrent video downloads (semaphore)
//! - Download cancellation tokens for aborting in-progress downloads

use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
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
    /// IDs cancelled before `download_video` started (pre-enqueued pending
    /// children that are not in `tokens` yet). `download_video` checks this
    /// on start and rejects immediately so cancelled pending parts never run.
    cancelled_ids: Mutex<HashSet<String>>,
}

impl DownloadCancelRegistry {
    /// Creates a new empty registry.
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            cancelled_ids: Mutex::new(HashSet::new()),
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

    /// Signals cancellation for a specific download and removes its token
    /// from the registry.
    ///
    /// Removing the token makes `cancel()` idempotent: a second call for the
    /// same id (e.g. a double-clicked cancel button) returns `false`, so
    /// `cancel_download` does not emit a duplicate `download_cancelled`
    /// event (which would surface a second "cancelled" toast). The id is
    /// also recorded in `cancelled_ids` so paths that re-fetch the token via
    /// `get_token` (retry backoff, playurl fetch, bangumi-durl) can still
    /// detect the cancel via `is_cancelled` instead of running to completion.
    ///
    /// # Arguments
    ///
    /// * `download_id` - Unique identifier for the download to cancel
    ///
    /// # Returns
    ///
    /// `true` if the token existed and was cancelled (and removed), `false`
    /// if the download was not found (never started, already completed, or
    /// already cancelled by a previous call)
    pub async fn cancel(&self, download_id: &str) -> bool {
        // Remove the token (not just flag it) so a duplicate cancel_download
        // returns false. Hold the tokens lock only for the Map mutation and
        // release it before locking cancelled_ids. Holding two mutexes at
        // once is a deadlock hazard in general, so we keep each guard in its
        // own scope even though no current caller nests them.
        let token_opt = {
            let mut tokens = self.tokens.lock().await;
            tokens.remove(download_id)
        };
        if let Some(token) = token_opt {
            token.cancel();
            log::info!("[BE] download cancelled: id={}", download_id);
            let mut ids = self.cancelled_ids.lock().await;
            ids.insert(download_id.to_string());
            true
        } else {
            log::warn!(
                "[BE] cancel called but download not found: id={}",
                download_id
            );
            false
        }
    }

    /// Signals cancellation for all registered downloads and clears the
    /// registry.
    ///
    /// Clearing mirrors `cancel()`'s removal semantics: subsequent per-id
    /// `cancel_download` calls for these ids return `false`, avoiding
    /// duplicate `download_cancelled` events when cancel-all and per-part
    /// cancel race on the same id.
    ///
    /// # Returns
    ///
    /// Number of downloads cancelled (the count captured before clearing)
    pub async fn cancel_all(&self) -> usize {
        let mut tokens = self.tokens.lock().await;
        let count = tokens.len();
        for token in tokens.values() {
            token.cancel();
        }
        // Constraint: unlike cancel(), this path does NOT record ids in
        // cancelled_ids — clearing tokens alone satisfies the idempotency
        // goal (a later per-id cancel returns false). The get_token-None
        // fallback in download_url/single_stream_fallback reads
        // cancelled_ids, so mid-retry cancel detection here depends on the
        // caller having pre-marked the ids. The sole production caller
        // (cancel_all_downloads in lib.rs) does this via mark_cancelled_many
        // before invoking cancel_all.
        // Caution: any future direct caller of cancel_all() must pre-mark the
        // ids, otherwise a download sitting in retry backoff would lose its
        // token here yet read is_cancelled=false and run to completion.
        tokens.clear();
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

    /// Marks a download ID as cancelled before it started (pending parts not
    /// yet registered as tokens). `download_video` checks this on start.
    pub async fn mark_cancelled(&self, download_id: &str) {
        let mut ids = self.cancelled_ids.lock().await;
        ids.insert(download_id.to_string());
    }

    /// Marks multiple download IDs as cancelled at once.
    pub async fn mark_cancelled_many(&self, download_ids: &[String]) {
        let mut ids = self.cancelled_ids.lock().await;
        for id in download_ids {
            ids.insert(id.clone());
        }
    }

    /// Returns true if the download ID was cancelled before it started.
    pub async fn is_cancelled(&self, download_id: &str) -> bool {
        let ids = self.cancelled_ids.lock().await;
        ids.contains(download_id)
    }

    /// Clears the pre-cancelled flag for a download ID.
    pub async fn clear_cancelled(&self, download_id: &str) {
        let mut ids = self.cancelled_ids.lock().await;
        ids.remove(download_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The core fix: a second cancel for the same id must return false so
    /// cancel_download does not emit a duplicate `download_cancelled` event
    /// (the "cancelled" toast showing twice on double-click).
    #[tokio::test]
    async fn cancel_is_idempotent_on_second_call() {
        let registry = DownloadCancelRegistry::new();
        let id = "test-id-idempotent";

        registry.register(id).await;
        assert!(registry.cancel(id).await, "first cancel should return true");
        assert!(
            !registry.cancel(id).await,
            "second cancel should return false (idempotent — token was removed)"
        );
    }

    /// cancel() must record the id in cancelled_ids so download_url's
    /// get_token-None fallback (retry backoff, playurl fetch, bangumi-durl)
    /// can still detect the cancel via is_cancelled.
    #[tokio::test]
    async fn cancel_records_id_in_cancelled_ids_for_fallback() {
        let registry = DownloadCancelRegistry::new();
        let id = "test-id-fallback";

        registry.register(id).await;
        assert!(
            !registry.is_cancelled(id).await,
            "freshly registered id should not be cancelled"
        );

        registry.cancel(id).await;
        assert!(
            registry.is_cancelled(id).await,
            "cancel() should record the id so the get_token-None fallback can detect it"
        );
    }

    /// Guards against cancel-all × per-part cancel duplicate emit: once
    /// cancel_all has cleared the tokens, a per-id cancel must return false.
    #[tokio::test]
    async fn cancel_after_cancel_all_returns_false() {
        let registry = DownloadCancelRegistry::new();
        let id = "test-id-cancel-all";

        registry.register(id).await;
        registry.cancel_all().await;
        assert!(
            !registry.cancel(id).await,
            "per-id cancel after cancel_all should return false (no duplicate emit)"
        );
    }

    /// Prerequisite for the get_token-None fallback path: cancel() must
    /// remove the token so get_token returns None for in-flight callers.
    #[tokio::test]
    async fn cancel_removes_token_so_get_token_returns_none() {
        let registry = DownloadCancelRegistry::new();
        let id = "test-id-get-token";

        registry.register(id).await;
        assert!(registry.get_token(id).await.is_some());

        registry.cancel(id).await;
        assert!(
            registry.get_token(id).await.is_none(),
            "cancel() should remove the token so get_token returns None"
        );
    }
}
