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

// impl Default for Progress {
//     fn default() -> Self {
//         Self {
//             download_id: String::new(),
//             filesize: 0,
//             downloaded: 0,
//             transfer_rate: 0.0,
//             percentage: 0.0,
//             delta_time: 0.0,
//         }
//     }
// }

pub struct Emits {
    app: AppHandle,
    progress: Progress,
}

impl Emits {
    pub fn new(app: AppHandle, download_id: String, filesize: u64) -> Self {
        Emits {
            app: app,
            progress: Progress::default(),
        }
    }

    pub fn update_progress(&mut self, downloaded: u64) {
        self.progress.downloaded = downloaded;

        return;
    }

    pub fn send_progress(&self) {
        let _ = self.app.emit("progress", self.progress.clone());
    }
}
