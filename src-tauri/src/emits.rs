use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// Frontendへのイベントを送信するためのモジュール
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Progress {
    #[serde(rename = "downloadId")]
    pub download_id: String,
    #[serde(rename = "filesize")]
    pub filesize: f64,
    #[serde(rename = "downloaded")]
    pub downloaded: f64,
    #[serde(rename = "transferRate")]
    pub transfer_rate: f64,
    #[serde(rename = "percentage")]
    pub percentage: f64,
    #[serde(rename = "deltaTime")]
    pub delta_time: f64,
    // 累計の経過時間（秒）
    #[serde(rename = "elapsedTime")]
    pub elapsed_time: f64,
    #[serde(rename = "isComplete")]
    pub is_complete: bool,
}

pub struct Emits {
    app: AppHandle,
    progress: Progress,
    start_instant: Instant,
    last_instant: Instant,
    last_downloaded_mb: f64,
    current_downloaded_mb: f64,
}

impl Emits {
    pub fn new(app: AppHandle, download_id: String, filesize_bytes: u64) -> Self {
        let filesize_mb: f64 = filesize_bytes as f64 / 1024.0 / 1024.0; // Convert bytes to MB
        let now = Instant::now();
        Emits {
            app: app,
            progress: Progress {
                download_id,
                filesize: filesize_mb,
                downloaded: 0.0,
                transfer_rate: 0.0,
                percentage: 0.0,
                delta_time: 0.0,
                elapsed_time: 0.0,
                is_complete: false,
            },
            start_instant: now,
            last_instant: now,
            last_downloaded_mb: 0.0,
            current_downloaded_mb: 0.0,
        }
    }

    pub fn update_progress(&mut self, downloaded_bytes: u64) {
        // Byte -> MB（小数維持）
        let downloaded_mb: f64 = downloaded_bytes as f64 / 1024.0 / 1024.0;
        // 内部保持（小数）
        self.current_downloaded_mb = downloaded_mb;

        return;
    }
    pub fn complete(&mut self) {
        // 完了時点の累計経過時間を更新
        let now = Instant::now();
        let elapsed = now.duration_since(self.start_instant).as_secs_f64();
        // 完了時はファイルサイズに設定
        // -> 0.1sごとにemitしているのでタイミングによっては100%にならずに終了することがあることを考慮
        self.progress.downloaded = self.progress.filesize;
        self.progress.percentage = 100.0; // 完了時は100%
        self.progress.elapsed_time = round_to(elapsed, 1);
        self.progress.is_complete = true;
        // Emitterを使用してイベントを送信
        let _ = self.app.emit("progress", self.progress.clone());
    }

    pub fn send_progress(&mut self) {
        let mut prg = self.progress.clone();
        // 差分時間（秒）
        let now = Instant::now();
        let delta_time = now.duration_since(self.last_instant).as_secs_f64();
        // 累計経過時間（秒）
        let elapsed_time = now.duration_since(self.start_instant).as_secs_f64();

        // 進捗率を計算
        if self.progress.filesize > 0.0 {
            prg.percentage = (self.current_downloaded_mb / self.progress.filesize) * 100.0;
        } else {
            prg.percentage = 0.0;
        }
        // 転送速度（MB/s）= ΔMB / Δsec
        if delta_time > 0.0 {
            let delta_mb = (self.current_downloaded_mb - self.last_downloaded_mb).max(0.0);
            prg.transfer_rate = delta_mb / delta_time;
        } else {
            prg.transfer_rate = 0.0;
        }
        // 差分時間を更新
        prg.delta_time = delta_time;
        // 累計経過時間を更新（丸め）
        prg.elapsed_time = round_to(elapsed_time, 1);

        // 表示用の値に丸め（filesize/downloaded: 1桁, percentage: 0桁, transfer_rate: 2桁）
        prg.filesize = round_to(self.progress.filesize, 1);
        prg.downloaded = round_to(self.current_downloaded_mb, 1);
        prg.percentage = round_to(prg.percentage, 0);
        prg.transfer_rate = round_to(prg.transfer_rate, 1);

        // 内部状態を更新
        self.last_instant = now;
        self.last_downloaded_mb = self.current_downloaded_mb;
        self.progress = prg;

        // Emitterを使用してイベントを送信
        let _ = self.app.emit("progress", self.progress.clone());
    }
}

fn round_to(v: f64, places: i32) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    let p = 10f64.powi(places.max(0));
    (v * p).round() / p
}
