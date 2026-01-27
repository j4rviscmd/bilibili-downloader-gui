//! Progress Event Emission Module
//!
//! This module provides functionality for emitting download progress events to the frontend.
//! It manages progress tracking with automatic periodic updates and supports multiple
//! download stages (audio, video, merge, complete).

use std::time::Instant;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{spawn, sync::Mutex, time};

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
struct EmitsInner {
    progress: Progress,
    start_instant: Instant,
    last_instant: Instant,
    last_downloaded_bytes: u64,
    current_downloaded_bytes: u64,
    /// Flag to stop the internal timer when download completes
    is_complete: bool,
}

/// Progress emitter that sends periodic updates to the frontend.
///
/// This struct manages download progress tracking and automatically emits
/// progress events every 100ms. It spawns a background task that runs
/// until the download completes.
pub struct Emits {
    app: AppHandle,
    inner: Arc<Mutex<EmitsInner>>,
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
        let filesize_mb: Option<f64> =
            filesize_bytes.map(|filesize_bytes| filesize_bytes as f64 / 1024.0 / 1024.0);
        let now = Instant::now();
        let inner = Arc::new(Mutex::new(EmitsInner {
            progress: Progress {
                download_id,
                stage: None,
                filesize: filesize_mb,
                downloaded: None,
                transfer_rate: 0.0,
                percentage: 0.0,
                delta_time: 0.0,
                elapsed_time: 0.0,
                is_complete: false,
            },
            start_instant: now,
            last_instant: now,
            last_downloaded_bytes: 0,
            current_downloaded_bytes: 0,
            is_complete: false,
        }));

        let this = Emits {
            app: app.clone(),
            inner: inner.clone(),
        };

        // Send initial progress immediately after creation
        match inner.try_lock() {
            Ok(mut guard) => {
                Self::send_progress_locked(&app, &mut guard);
            }
            Err(_) => {
                #[cfg(debug_assertions)]
                eprintln!("[Emits] Failed to acquire lock for initial progress emit");
            }
        }

        // Emitインスタンス生成と同時に0.1s間隔のタイマーを開始
        spawn(async move {
            let mut ticker = time::interval(time::Duration::from_millis(100));
            loop {
                ticker.tick().await;
                // 完了済みなら終了
                let mut guard = inner.lock().await;
                if guard.is_complete {
                    break;
                }
                // 進捗を計算してemit
                Self::send_progress_locked(&app, &mut guard);
            }
        });

        this
    }

    /// Updates the current download progress.
    ///
    /// This method updates the total bytes downloaded. The actual progress
    /// calculation and emission happens in the background update task.
    ///
    /// # Arguments
    ///
    /// * `downloaded_bytes` - Total number of bytes downloaded so far
    pub async fn update_progress(&self, downloaded_bytes: u64) {
        match self.inner.try_lock() {
            Ok(mut guard) => {
                guard.current_downloaded_bytes = downloaded_bytes;
            }
            Err(_) => {
                #[cfg(debug_assertions)]
                eprintln!("[Emits] Failed to acquire lock for progress update");
            }
        }
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
        // Send immediate update reflecting stage change
        Self::send_progress_locked(&self.app, &mut guard);
    }

    /// Marks the download as complete and stops the update task.
    ///
    /// This method sets the progress to 100%, emits a final progress event,
    /// and stops the background update task.
    pub async fn complete(&self) {
        // 完了時点の累計経過時間を更新
        let mut guard = self.inner.lock().await;
        let now = Instant::now();
        let elapsed = now.duration_since(guard.start_instant).as_secs_f64();
        // 完了時はファイルサイズに設定
        if let Some(fs_mb) = guard.progress.filesize {
            guard.progress.downloaded = Some(fs_mb);
        }
        guard.progress.percentage = 100.0; // 完了時は100%
        guard.progress.elapsed_time = round_to(elapsed, 1);
        guard.progress.is_complete = true;
        // タイマー停止
        guard.is_complete = true;
        // 最終進捗をemit
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
        let filesize_mb: f64 = filesize_bytes as f64 / 1024.0 / 1024.0;
        let mut guard = self.inner.lock().await;
        // 既に設定済みで値が同じなら何もしない
        if let Some(existing) = guard.progress.filesize {
            if (existing - filesize_mb).abs() < f64::EPSILON {
                return;
            }
        }
        guard.progress.filesize = Some(filesize_mb);
        // 進捗再計算と即時送信
        Self::send_progress_locked(&self.app, &mut guard);
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
    fn send_progress_locked(app: &AppHandle, inner: &mut EmitsInner) {
        let mut prg = inner.progress.clone();
        // 差分時間（秒）
        let now = Instant::now();
        let delta_time = now.duration_since(inner.last_instant).as_secs_f64();
        // 累計経過時間（秒）
        let elapsed_time = now.duration_since(inner.start_instant).as_secs_f64();
        // バイト量が増えたタイミングのみ速度/進捗を再計算する
        let bytes_changed = inner.current_downloaded_bytes != inner.last_downloaded_bytes;
        if bytes_changed {
            // 進捗率を計算
            if inner.progress.filesize.is_none() {
                prg.percentage = 0.0;
            } else if inner.progress.filesize.unwrap() > 0.0 {
                // filesize は MB 単位
                let downloaded_mb = inner.current_downloaded_bytes as f64 / 1024.0 / 1024.0;
                prg.percentage = (downloaded_mb / inner.progress.filesize.unwrap()) * 100.0;
            } else {
                prg.percentage = 0.0;
            }
            // 転送速度（平均, KB/s）= 累計ダウンロードバイト / 経過秒 / 1024
            if elapsed_time > 0.0 {
                prg.transfer_rate = (inner.current_downloaded_bytes as f64 / elapsed_time) / 1024.0;
            } else {
                prg.transfer_rate = 0.0;
            }
        }
        // 差分時間を更新
        prg.delta_time = delta_time;
        // 累計経過時間を更新（丸め）
        prg.elapsed_time = round_to(elapsed_time, 1);
        // 表示用の丸めは bytes_changed のときだけ進捗値を更新。経過時間は毎回更新。
        if bytes_changed && inner.progress.filesize.is_some() {
            prg.filesize = Some(round_to(inner.progress.filesize.unwrap(), 1));
            prg.downloaded = Some(round_to(
                inner.current_downloaded_bytes as f64 / 1024.0 / 1024.0,
                1,
            ));
            prg.percentage = round_to(prg.percentage, 0);
            prg.transfer_rate = round_to(prg.transfer_rate, 1);
        }

        // 内部状態を更新
        inner.last_instant = now;
        if bytes_changed {
            inner.last_downloaded_bytes = inner.current_downloaded_bytes;
        }
        inner.progress = prg;

        // Emitterを使用してイベントを送信
        let _ = app.emit("progress", inner.progress.clone());
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
