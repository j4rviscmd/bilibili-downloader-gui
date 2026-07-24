//! Progress Event Emission Module
//!
//! This module provides functionality for emitting download progress events to the frontend.
//! It manages progress tracking with automatic periodic updates and supports multiple
//! download stages (audio, video, merge, complete).

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::{spawn, sync::watch, sync::Mutex, time};

/// Progress update interval in milliseconds.
const PROGRESS_UPDATE_INTERVAL_MS: u64 = 500;

/// Progress information structure sent to the frontend.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Progress {
    /// Current download stage (e.g., "audio", "video", "merge", "complete")
    #[serde(rename = "stage")]
    pub stage: Option<String>,
    /// Unique identifier for this download operation
    #[serde(rename = "downloadId")]
    pub download_id: String,
    /// Total file size in megabytes
    #[serde(rename = "filesize")]
    pub filesize: Option<f64>,
    /// Downloaded data in megabytes
    #[serde(rename = "downloaded")]
    pub downloaded: Option<f64>,
    /// Current transfer rate in KB/s
    #[serde(rename = "transferRate")]
    pub transfer_rate: f64,
    /// Completion percentage (0-100)
    #[serde(rename = "percentage")]
    pub percentage: f64,
    /// Time elapsed since last update in seconds
    #[serde(rename = "deltaTime")]
    pub delta_time: f64,
    /// Total elapsed time since download start in seconds
    #[serde(rename = "elapsedTime")]
    pub elapsed_time: f64,
    /// Whether the download has completed
    #[serde(rename = "isComplete")]
    pub is_complete: bool,
    /// Whether the download is currently retrying (e.g., CDN rotation).
    /// When true, the frontend hides transfer rate display to avoid flicker
    /// between pre-retry and post-retry speed values.
    ///
    /// `None` means "no explicit signal" — the frontend preserves the
    /// previous value. This allows retry_download's new `Emits` instance
    /// (which defaults to `None`) to not clobber a retrying state set
    /// via the separate `download-retrying` event.
    #[serde(rename = "isRetrying")]
    pub is_retrying: Option<bool>,
}

/// Internal state for progress tracking.
///
/// Maintains timing information and byte counts for calculating
/// transfer rates and progress percentages.
struct EmitsInner {
    progress: Progress,
    start_instant: Instant,
    last_instant: Instant,
    last_downloaded_bytes: u64,
    is_complete: bool,
    last_speed_calc_instant: Instant,
    last_speed_calc_bytes: u64,
    last_speed_kbps: f64,
}

impl Default for EmitsInner {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            progress: Default::default(),
            start_instant: now,
            last_instant: now,
            last_speed_calc_instant: now,
            last_downloaded_bytes: 0,
            last_speed_calc_bytes: 0,
            is_complete: false,
            last_speed_kbps: 0.0,
        }
    }
}

/// Progress emitter that sends periodic updates to the frontend.
///
/// This struct manages download progress tracking and automatically emits
/// progress events every 100ms. It spawns a background task that runs
/// until the download completes.
///
/// Uses watch::Sender for lock-free progress updates from download thread,
/// avoiding contention with the background emission task.
pub struct Emits {
    app: AppHandle,
    inner: Arc<Mutex<EmitsInner>>,
    progress_tx: watch::Sender<u64>,
}

impl Emits {
    /// Creates a new progress emitter and starts automatic updates.
    ///
    /// This function initializes the progress tracker, emits an initial progress
    /// event immediately, and spawns a background task that emits progress updates
    /// every 100ms until the download completes.
    ///
    /// # Arguments
    ///
    /// * `app` - Tauri application handle for event emission
    /// * `download_id` - Unique identifier for this download
    /// * `filesize_bytes` - Optional total file size in bytes
    ///
    /// # Returns
    ///
    /// Returns a new `Emits` instance with an active background update task.
    pub fn new(app: AppHandle, download_id: String, filesize_bytes: Option<u64>) -> Self {
        fn bytes_to_mb(bytes: u64) -> f64 {
            bytes as f64 / (1024.0 * 1024.0)
        }

        let now = Instant::now();
        let inner = Arc::new(Mutex::new(EmitsInner {
            progress: Progress {
                download_id,
                filesize: filesize_bytes.map(|b| round_to(bytes_to_mb(b), 1)),
                ..Default::default()
            },
            start_instant: now,
            last_instant: now,
            last_speed_calc_instant: now,
            ..Default::default()
        }));

        // Create watch channel for lock-free progress updates
        let (progress_tx, mut progress_rx) = watch::channel(0u64);

        // Send initial progress immediately
        if let Ok(mut guard) = inner.try_lock() {
            Self::send_progress_locked(&app, &mut guard, 0);
        }

        // Spawn background task to emit progress with select! for ticker and watch channel
        let inner_for_task = inner.clone();
        let app_for_task = app.clone();
        spawn(async move {
            let mut ticker =
                time::interval(time::Duration::from_millis(PROGRESS_UPDATE_INTERVAL_MS));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let mut guard = inner_for_task.lock().await;
                        if guard.is_complete {
                            break;
                        }
                        let bytes = *progress_rx.borrow();
                        Self::send_progress_locked(&app_for_task, &mut guard, bytes);
                    }
                    Ok(()) = progress_rx.changed() => {
                        // Progress updated via watch channel - will be reflected on next tick
                        // This wakes up the select loop but actual emission happens on ticker
                    }
                }
            }
        });

        Emits {
            app,
            inner,
            progress_tx,
        }
    }

    /// Updates the current download progress.
    ///
    /// This method updates the total bytes downloaded via a watch channel,
    /// avoiding lock contention with the background emission task.
    /// The actual progress calculation and emission happens in the background.
    ///
    /// # Arguments
    ///
    /// * `downloaded_bytes` - Total number of bytes downloaded so far
    pub fn update_progress(&self, downloaded_bytes: u64) {
        // Send via watch channel - non-blocking, replaces old value
        let _ = self.progress_tx.send(downloaded_bytes);
    }

    /// Sets the current download stage and emits an immediate update.
    ///
    /// This method is used to indicate different phases of the download process
    /// (e.g., "audio", "video", "merge", "complete").
    ///
    /// # Arguments
    ///
    /// * `stage` - Stage identifier string
    pub async fn set_stage(&self, stage: &str) {
        let mut guard = self.inner.lock().await;
        guard.progress.stage = Some(stage.to_string());
        // Get current bytes from watch channel for immediate update
        let bytes = *self.progress_tx.subscribe().borrow();
        // Send immediate update reflecting stage change
        Self::send_progress_locked(&self.app, &mut guard, bytes);
    }

    /// Stops the background update task without emitting a complete event.
    ///
    /// Emits a final progress event reflecting the actual bytes downloaded.
    /// Called on both success paths (where bytes equal filesize, so the
    /// percentage naturally reaches 100%) and error/cancel paths (where the
    /// real progress is preserved instead of being forced to 100%).
    ///
    /// CAUTION: Do NOT force `percentage = 100` here. `stop()` is also used
    /// on error paths (segment failures, size mismatch, cancellation), and
    /// forcing 100% would mislead the frontend — combined with the frontend's
    /// monotonic clamp, the progress bar would lock at 100% even while
    /// `retry_download` keeps retrying in the background. On success paths
    /// the bytes already equal filesize, so recalculating yields 100%.
    ///
    /// NOTE: This does NOT set `progress.is_complete = true`; only the
    /// internal timer-stop flag is set. Use [`complete()`] for the final
    /// completion signal that switches the frontend stage to "complete".
    pub async fn stop(&self) {
        let mut guard = self.inner.lock().await;
        guard.is_complete = true; // Stop background timer

        // Recalculate from actual bytes so error paths preserve real progress
        // instead of locking the frontend's monotonic clamp at 100%.
        let bytes = *self.progress_tx.subscribe().borrow();
        Self::send_progress_locked(&self.app, &mut guard, bytes);
    }

    /// Marks the download as complete and stops the update task.
    ///
    /// This method sets the progress to 100%, emits a final progress event,
    /// and stops the background update task.
    pub async fn complete(&self) {
        let mut guard = self.inner.lock().await;
        let now = Instant::now();
        let elapsed = now.duration_since(guard.start_instant).as_secs_f64();

        // Set downloaded to filesize on completion
        if let Some(fs_mb) = guard.progress.filesize {
            guard.progress.downloaded = Some(fs_mb);
        }
        guard.progress.percentage = 100.0;
        guard.progress.elapsed_time = round_to(elapsed, 1);
        guard.progress.is_complete = true;
        guard.progress.stage = Some("complete".to_string()); // Set stage for frontend detection
        guard.is_complete = true; // Stop background timer

        let _ = self.app.emit("progress", guard.progress.clone());
    }

    /// Updates the total file size when it becomes known during download.
    ///
    /// This method is useful when the total size is not available at the start
    /// of the download but is discovered later (e.g., from Content-Length header
    /// after the first chunk is received).
    ///
    /// # Arguments
    ///
    /// * `filesize_bytes` - Total file size in bytes
    pub async fn update_total(&self, filesize_bytes: u64) {
        let filesize_mb = round_to(filesize_bytes as f64 / (1024.0 * 1024.0), 1);
        let mut guard = self.inner.lock().await;

        // Skip if already set to the same value
        if guard.progress.filesize == Some(filesize_mb) {
            return;
        }

        guard.progress.filesize = Some(filesize_mb);
        // Get current bytes from watch channel
        let bytes = *self.progress_tx.subscribe().borrow();
        Self::send_progress_locked(&self.app, &mut guard, bytes);
    }

    /// Internal method: Calculates progress and emits event with lock held.
    ///
    /// This method calculates transfer rate, percentage, and timing information,
    /// then emits a progress event to the frontend. It should only be called
    /// when the inner mutex is already locked.
    ///
    /// # Arguments
    ///
    /// * `app` - Tauri application handle for event emission
    /// * `inner` - Mutable reference to the locked inner state
    fn send_progress_locked(app: &AppHandle, inner: &mut EmitsInner, current_bytes: u64) {
        let now = Instant::now();
        let delta_time = now.duration_since(inner.last_instant).as_secs_f64();
        let elapsed_time = now.duration_since(inner.start_instant).as_secs_f64();
        let bytes_changed = current_bytes != inner.last_downloaded_bytes;

        if bytes_changed {
            // Calculate percentage
            inner.progress.percentage =
                Self::calculate_percentage(current_bytes, inner.progress.filesize);

            // Transfer rate: recompute every ~1s from the byte delta and
            // reuse the last value in between ticks.
            // Note: EMA smoothing and the paired per-segment retry-hiding
            //   helpers (reset_speed_tracking / set_retrying) were removed in
            //   #491. Because each recompute derives from the current byte
            //   baseline, a stalled CDN no longer bleeds its low speed across
            //   CDN rotation, so the hide-on-retry display mask is no longer
            //   needed.
            let time_since_last_calc = now
                .duration_since(inner.last_speed_calc_instant)
                .as_secs_f64();
            if time_since_last_calc >= 1.0 {
                let bytes_delta = current_bytes.saturating_sub(inner.last_speed_calc_bytes);
                let speed_kbps = (bytes_delta as f64 / 1024.0) / time_since_last_calc;
                inner.progress.transfer_rate = speed_kbps;
                inner.last_speed_kbps = speed_kbps;
                inner.last_speed_calc_instant = now;
                inner.last_speed_calc_bytes = current_bytes;
            } else if inner.last_speed_kbps > 0.0 {
                inner.progress.transfer_rate = inner.last_speed_kbps;
            }

            // Round values for display
            if inner.progress.filesize.is_some() {
                inner.progress.downloaded =
                    Some(round_to(current_bytes as f64 / (1024.0 * 1024.0), 1));
                // Cap percentage at 100 to prevent display issues (e.g., 101%)
                inner.progress.percentage = round_to(inner.progress.percentage, 0).min(100.0);
                inner.progress.transfer_rate = round_to(inner.progress.transfer_rate, 1);
            }

            inner.last_downloaded_bytes = current_bytes;
        }

        inner.progress.delta_time = delta_time;
        inner.progress.elapsed_time = round_to(elapsed_time, 1);
        inner.last_instant = now;

        let _ = app.emit("progress", inner.progress.clone());
    }

    /// Calculates download percentage based on bytes downloaded and total file size.
    fn calculate_percentage(downloaded_bytes: u64, filesize_mb: Option<f64>) -> f64 {
        let Some(fs) = filesize_mb else { return 0.0 };
        if fs == 0.0 {
            return 0.0;
        }
        let downloaded_mb = downloaded_bytes as f64 / (1024.0 * 1024.0);
        (downloaded_mb / fs) * 100.0
    }
}

/// Rounds a floating-point value to a specified number of decimal places.
///
/// Returns 0.0 if the input value is not finite (NaN or infinite).
///
/// # Arguments
///
/// * `v` - Value to round
/// * `places` - Number of decimal places (non-negative)
///
/// # Returns
///
/// Returns the rounded value, or 0.0 if the input is not finite.
fn round_to(v: f64, places: i32) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    let p = 10f64.powi(places.max(0));
    (v * p).round() / p
}
