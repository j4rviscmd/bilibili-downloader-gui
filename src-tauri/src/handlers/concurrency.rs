use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Semaphore;

// 最大同時動画ダウンロード数（ファイル単位の並行処理上限）
// デフォルトは 8
pub static VIDEO_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(8)));
