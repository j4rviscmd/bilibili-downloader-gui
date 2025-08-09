use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// Frontendへのイベントを送信するためのモジュール
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Progress {
    pub download_id: String,
    pub filesize: u64,
    pub downloaded: u64,
    pub transfer_rate: f64,
    pub percentage: f64,
    pub delta_time: f64,
}

pub struct Emits {
    app: AppHandle,
    progress: Progress,
}

impl Emits {
    pub fn new(app: AppHandle, download_id: String, filesize_bytes: u64) -> Self {
        let filesize_mb: f64 = filesize_bytes as f64 / 1024.0 / 1024.0; // Convert bytes to MB
        Emits {
            app: app,
            progress: Progress {
                download_id,
                filesize: filesize_mb as u64,
                downloaded: 0,
                transfer_rate: 0.0,
                percentage: 0.0,
                delta_time: 0.0,
            },
        }
    }

    pub fn update_progress(&mut self, downloaded_bytes: u64) {
        // Byte to MB
        let downloaded_mb: f64 = downloaded_bytes as f64 / 1024.0 / 1024.0;
        // f64 to u64
        self.progress.downloaded = downloaded_mb as u64;

        return;
    }

    pub fn send_progress(&mut self) {
        let mut prg = self.progress.clone();
        // 現在の時間を取得
        let now = Instant::now();
        // 前回の時間との差分を計算
        let delta_time = now.elapsed().as_secs_f64();

        // 進捗率を計算
        if prg.filesize > 0 {
            prg.percentage = (prg.downloaded as f64 / prg.filesize as f64) * 100.0;
        } else {
            prg.percentage = 0.0;
        }
        // 転送速度を計算
        if delta_time > 0.0 {
            prg.transfer_rate = prg.downloaded as f64 / delta_time;
        } else {
            prg.transfer_rate = 0.0;
        }
        // 差分時間を更新
        prg.delta_time = delta_time;

        // Update instance variables
        self.progress = prg;

        // Emitterを使用してイベントを送信
        let _ = self.app.emit("progress", self.progress.clone());
    }
}
