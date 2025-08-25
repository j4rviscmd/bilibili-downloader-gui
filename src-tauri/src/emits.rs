use std::time::Instant;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::{spawn, sync::Mutex, time};

// Frontendへのイベントを送信するためのモジュール
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Progress {
    #[serde(rename = "downloadId")]
    pub download_id: String,
    #[serde(rename = "filesize")]
    pub filesize: Option<f64>,
    #[serde(rename = "downloaded")]
    pub downloaded: Option<f64>,
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

struct EmitsInner {
    progress: Progress,
    start_instant: Instant,
    last_instant: Instant,
    last_downloaded_bytes: u64,
    current_downloaded_bytes: u64,
    // 内部タイマーの終了フラグ
    is_complete: bool,
}

pub struct Emits {
    app: AppHandle,
    inner: Arc<Mutex<EmitsInner>>,
}

impl Emits {
    pub fn new(app: AppHandle, download_id: String, filesize_bytes: Option<u64>) -> Self {
        let filesize_mb: Option<f64> = if let Some(filesize_bytes) = filesize_bytes {
            Some(filesize_bytes as f64 / 1024.0 / 1024.0)
        } else {
            None
        };
        let now = Instant::now();
        let inner = Arc::new(Mutex::new(EmitsInner {
            progress: Progress {
                download_id,
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

        // 生成直後に1回フロントへ送信
        if let Ok(mut guard) = inner.try_lock() {
            Self::send_progress_locked(&app, &mut *guard);
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
                Self::send_progress_locked(&app, &mut *guard);
            }
        });

        this
    }

    pub async fn update_progress(&self, downloaded_bytes: u64) {
        if let Ok(mut guard) = self.inner.try_lock() {
            guard.current_downloaded_bytes = downloaded_bytes;
        }
    }
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

    // ダウンロード途中で総サイズが後から判明した場合に更新するためのユーティリティ
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
        Self::send_progress_locked(&self.app, &mut *guard);
    }

    // 内部用: ミューテックス取得済みで進捗を計算・送信
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

fn round_to(v: f64, places: i32) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    let p = 10f64.powi(places.max(0));
    (v * p).round() / p
}
