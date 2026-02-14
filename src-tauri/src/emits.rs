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
/// The background task emits progress events at this frequency.
const PROGRESS_UPDATE_INTERVAL_MS: u64 = 500;

/// Progress information structure sent to the frontend.
///
/// This structure represents the current state of a download operation,
/// including transfer rates, completion percentage, and elapsed time.
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
}

/// Internal state for progress tracking.
///
/// This structure maintains timing information and byte counts for
/// calculating transfer rates and progress percentages.
/// Note: current_downloaded_bytes is now managed via watch::Sender/Receiver
/// to avoid lock contention between download thread and background task.
struct EmitsInner {
    progress: Progress,
    start_instant: Instant,
    last_instant: Instant,
    last_downloaded_bytes: u64,
    /// Flag to stop the internal timer when download completes
    is_complete: bool,
    /// Last time speed was calculated (for 1-second interval EMA calculation)
    last_speed_calc_instant: Instant,
    /// Bytes downloaded at last speed calculation
    last_speed_calc_bytes: u64,
    /// EMA smoothed speed in KB/s (exponential moving average)
    smoothed_speed_kbps: f64,
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
            smoothed_speed_kbps: 0.0,
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

            // Calculate smoothed transfer rate (EMA)
            inner.progress.transfer_rate = Self::calculate_smoothed_speed(
                now,
                current_bytes,
                inner.smoothed_speed_kbps,
                inner.last_speed_calc_instant,
                inner.last_speed_calc_bytes,
            );

            // Update speed calculation state
            let time_since_last_calc = now
                .duration_since(inner.last_speed_calc_instant)
                .as_secs_f64();
            if time_since_last_calc >= 1.0 {
                inner.smoothed_speed_kbps = inner.progress.transfer_rate;
                inner.last_speed_calc_instant = now;
                inner.last_speed_calc_bytes = current_bytes;
            }

            // Round values for display
            if inner.progress.filesize.is_some() {
                inner.progress.downloaded =
                    Some(round_to(current_bytes as f64 / (1024.0 * 1024.0), 1));
                inner.progress.percentage = round_to(inner.progress.percentage, 0);
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

    /// Calculates EMA-smoothed transfer rate in KB/s.
    ///
    /// Returns the smoothed speed, using the previous smoothed value as base
    /// and incorporating the instant speed measured since the last calculation.
    fn calculate_smoothed_speed(
        now: Instant,
        current_bytes: u64,
        prev_smoothed_kbps: f64,
        last_calc_instant: Instant,
        last_calc_bytes: u64,
    ) -> f64 {
        const SPEED_CALC_INTERVAL_SECS: f64 = 1.0;
        const EMA_ALPHA: f64 = 0.3; // Weight for new value (0.3), old value gets 0.7

        let time_since_last_calc = now.duration_since(last_calc_instant).as_secs_f64();

        if time_since_last_calc < SPEED_CALC_INTERVAL_SECS {
            return prev_smoothed_kbps;
        }

        let delta_bytes = current_bytes.saturating_sub(last_calc_bytes);
        let instant_speed_kbps = (delta_bytes as f64 / time_since_last_calc) / 1024.0;

        if prev_smoothed_kbps == 0.0 {
            instant_speed_kbps
        } else {
            prev_smoothed_kbps * (1.0 - EMA_ALPHA) + instant_speed_kbps * EMA_ALPHA
        }
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
