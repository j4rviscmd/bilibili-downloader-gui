use crate::{
    constants::{REFERER, USER_AGENT},
    emits::Emits,
};
use anyhow::Result;
use futures::stream::FuturesUnordered;
use futures::StreamExt;
use reqwest::header;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::AsyncSeekExt;
use tokio::sync::Semaphore;
use tokio::{fs, io::AsyncWriteExt};

// Detect if an IO error represents "No space left on device" (ENOSPC)
fn is_no_space_error(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(code) if code == 28) // Unix/macOS ENOSPC = 28
}

pub async fn download_url(
    app: &AppHandle,
    url: String,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
) -> Result<()> {
    // 基本チェック
    if output_path.exists() {
        if is_override {
            fs::remove_file(&output_path).await?;
            // DEBUG: removed existing file (kept for future logging)
            // println!("Removed existing file: {:?}", output_path);
        } else {
            return Err(anyhow::anyhow!("ERR::FILE_EXISTS"));
        }
    }

    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    // DEBUG: segmented download start
    // println!("Segmented download start: {} -> {:?}", url, output_path);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(120)) // 短め: セグメント/HEAD 用
        .build()?;

    // ---- 1. 総サイズ取得 ----
    let mut total_size: Option<u64> = None;
    // まず HEAD
    let mut head_builder = client.head(&url).header(header::REFERER, REFERER);
    if let Some(ref c) = cookie {
        head_builder = head_builder.header(header::COOKIE, c);
    }
    match head_builder.send().await {
        Ok(resp) => {
            // DEBUG: HEAD response status
            // println!("HEAD status: {}", resp.status());
            if let Some(len) = resp.headers().get(header::CONTENT_LENGTH) {
                if let Ok(s) = len.to_str() {
                    if let Ok(val) = s.parse::<u64>() {
                        total_size = Some(val);
                    }
                }
            }
        }
        Err(_e) => {
            // DEBUG: HEAD request failed (fallback to probe)
            // println!("HEAD request failed (will fallback to Range probe): {}", e);
        }
    }
    // Fallback: Range: bytes=0-0
    if total_size.is_none() {
        let mut probe = client
            .get(&url)
            .header(header::RANGE, "bytes=0-0")
            .header(header::REFERER, REFERER);
        if let Some(ref c) = cookie {
            probe = probe.header(header::COOKIE, c);
        }
        if let Ok(resp) = probe.send().await {
            // DEBUG: Range probe status
            // println!("Probe status: {}", resp.status());
            if let Some(cr) = resp.headers().get(header::CONTENT_RANGE) {
                if let Ok(s) = cr.to_str() {
                    // bytes START-END/TOTAL
                    if let Some(total_part) = s.rsplit('/').next() {
                        if let Ok(total_val) = total_part.parse::<u64>() {
                            total_size = Some(total_val);
                        }
                    }
                }
            }
        }
    }

    if total_size.is_none() {
        // Range サポート不明/サイズ不明 → 旧方式フォールバック (単一取得)
        // DEBUG: total size unknown -> fallback
        // println!("Total size unknown. Fallback to single-stream download.");
        return single_stream_fallback(app, url, output_path, cookie, is_override).await;
    }
    let total = total_size.unwrap();
    // DEBUG: total size & Accept-Ranges support
    // println!("Total size detected: {} bytes", total);

    // ---- 2. セグメント計画 ----
    const DEFAULT_SEGMENT_MB: u64 = 16; // 16MB
    let segment_size: u64 = DEFAULT_SEGMENT_MB * 1024 * 1024;
    let mut segments: Vec<(u64, u64)> = Vec::new(); // (start, end inclusive)
    let mut start: u64 = 0;
    while start < total {
        let end = (start + segment_size - 1).min(total - 1);
        segments.push((start, end));
        start = end + 1;
    }
    // DEBUG: planned segments count & size
    // println!("Planned segments: {} (segment_size={}MB)", segments.len(), DEFAULT_SEGMENT_MB);

    // 推奨並列度
    let concurrency: usize = if total < 64 * 1024 * 1024 { 1 } else { 3 };
    // DEBUG: concurrency chosen
    // println!("Concurrency: {}", concurrency);

    // ---- 3. ファイル確保 ----
    {
        let f_res = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&output_path)
            .await;
        let f = match f_res {
            Ok(f) => f,
            Err(e) if is_no_space_error(&e) => {
                return Err(anyhow::anyhow!("ERR::DISK_FULL"));
            }
            Err(e) => return Err(e.into()),
        };
        if let Err(e) = f.set_len(total).await {
            if is_no_space_error(&e) {
                return Err(anyhow::anyhow!("ERR::DISK_FULL"));
            } else {
                return Err(e.into());
            }
        } // 事前割り当て
    }

    let emits = Arc::new(Emits::new(app.clone(), filename.to_string(), Some(total)));
    let downloaded_total = Arc::new(AtomicU64::new(0));
    let sem = Arc::new(Semaphore::new(concurrency));

    // ---- 4. セグメント並列取得 ----
    let mut futs = FuturesUnordered::new();
    for (idx, (s, e)) in segments.iter().cloned().enumerate() {
        let url_c = url.clone();
        let cookie_c = cookie.clone();
        let path_c = output_path.clone();
        let client_c = client.clone();
        let dl_total_c = downloaded_total.clone();
        let emits_c = emits.clone();
        let sem_c = sem.clone();
        futs.push(tokio::spawn(async move {
            let _permit = sem_c.acquire().await.unwrap();
            let mut attempt: u8 = 0;
            let max_seg_retries: u8 = 10;
            let size = e - s + 1;
            loop {
                attempt += 1;
                // DEBUG: segment attempt start
                // println!("SEG{} range {}-{} ({} bytes) attempt {}", idx, s, e, size, attempt);
                let mut req = client_c
                    .get(&url_c)
                    .header(header::RANGE, format!("bytes={}-{}", s, e))
                    .header(header::REFERER, REFERER);
                if let Some(ref c) = cookie_c {
                    req = req.header(header::COOKIE, c);
                }
                match req.send().await {
                    Ok(mut resp) => {
                        if !(resp.status() == 206
                            || (s == 0
                                && resp.status() == 200
                                && size == resp.content_length().unwrap_or(size)))
                        {
                            // DEBUG: unexpected segment status
                            // println!("SEG{} unexpected status: {}", idx, resp.status());
                            if attempt < max_seg_retries {
                                backoff_sleep(attempt).await;
                                continue;
                            }
                            return Err(anyhow::anyhow!(
                                "segment {} unexpected status {}",
                                idx,
                                resp.status()
                            ));
                        }
                        // 書き込み(バッファリング)
                        let mut buf: Vec<u8> =
                            Vec::with_capacity(size.min(8 * 1024 * 1024) as usize);
                        let mut received: u64 = 0;
                        loop {
                            match resp.chunk().await {
                                Ok(Some(chunk)) => {
                                    received += chunk.len() as u64;
                                    buf.extend_from_slice(&chunk);
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    // DEBUG: segment chunk error
                                    // println!("SEG{} chunk error: {} (received {} / {} bytes)", idx, e, received, size);
                                    if attempt < max_seg_retries {
                                        backoff_sleep(attempt).await;
                                        continue;
                                    } else {
                                        return Err(anyhow::anyhow!(
                                            "segment {} chunk error: {e}",
                                            idx
                                        ));
                                    }
                                }
                            }
                        }
                        if received != size {
                            // DEBUG: size mismatch
                            // println!("SEG{} size mismatch received {} expected {}", idx, received, size);
                            if attempt < max_seg_retries {
                                backoff_sleep(attempt).await;
                                continue;
                            }
                            return Err(anyhow::anyhow!("segment {} size mismatch", idx));
                        }
                        let mut file = tokio::fs::OpenOptions::new()
                            .write(true)
                            .open(&path_c)
                            .await
                            .map_err(|e| {
                                if is_no_space_error(&e) {
                                    anyhow::anyhow!("ERR::DISK_FULL")
                                } else {
                                    e.into()
                                }
                            })?;
                        file.seek(std::io::SeekFrom::Start(s)).await.map_err(|e| {
                            if is_no_space_error(&e) {
                                anyhow::anyhow!("ERR::DISK_FULL")
                            } else {
                                e.into()
                            }
                        })?;
                        if let Err(e) = file.write_all(&buf).await {
                            if let Some(code) = e.raw_os_error() {
                                if code == 28 {
                                    // ENOSPC
                                    return Err(anyhow::anyhow!("ERR::DISK_FULL"));
                                }
                            }
                            return Err(e.into());
                        }
                        let new_total = dl_total_c.fetch_add(size, Ordering::Relaxed) + size;
                        emits_c.update_progress(new_total).await;
                        // DEBUG: segment done
                        // println!("SEG{} done ({} bytes) total={}", idx, size, new_total);
                        return Ok::<(), anyhow::Error>(());
                    }
                    Err(e) => {
                        // DEBUG: segment request error
                        // println!("SEG{} request error: {}", idx, e);
                        if attempt < max_seg_retries {
                            backoff_sleep(attempt).await;
                            continue;
                        }
                        return Err(anyhow::anyhow!("segment {} request error: {e}", idx));
                    }
                }
            }
        }));
    }

    let mut seg_errors = 0u32;
    while let Some(res) = futs.next().await {
        match res {
            Ok(Ok(())) => {}
            Ok(Err(_e)) => {
                // DEBUG: segment task error
                // println!("Segment task error: {e}");
                seg_errors += 1;
            }
            Err(_join_e) => {
                // DEBUG: join error
                // println!("Join error: {join_e}");
                seg_errors += 1;
            }
        }
    }

    if seg_errors > 0 {
        return Err(anyhow::anyhow!("{seg_errors} segment(s) failed"));
    }

    // 完了検証
    let final_downloaded = downloaded_total.load(Ordering::Relaxed);
    if final_downloaded != total {
        return Err(anyhow::anyhow!(
            "final size mismatch: {} vs {}",
            final_downloaded,
            total
        ));
    }
    emits.complete().await;
    // DEBUG: segmented download complete
    // println!("Segmented download complete: {} bytes", total);
    Ok(())
}

// 単一ストリームフォールバック (旧方式の簡易版)
async fn single_stream_fallback(
    app: &AppHandle,
    url: String,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
) -> Result<()> {
    if output_path.exists() && !is_override {
        return Err(anyhow::anyhow!("ERR::FILE_EXISTS"));
    }
    if output_path.exists() {
        fs::remove_file(&output_path).await.ok();
    }
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build()?;
    let mut req = client.get(&url).header(header::REFERER, REFERER);
    if let Some(ref c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let mut resp = req.send().await?;
    let total = resp.content_length();
    let filename = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let emits = Emits::new(app.clone(), filename.to_string(), total);
    let mut file = match tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&output_path)
        .await
    {
        Ok(f) => f,
        Err(e) if is_no_space_error(&e) => return Err(anyhow::anyhow!("ERR::DISK_FULL")),
        Err(e) => return Err(e.into()),
    };
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await? {
        if let Err(e) = file.write_all(&chunk).await {
            if is_no_space_error(&e) {
                return Err(anyhow::anyhow!("ERR::DISK_FULL"));
            } else {
                return Err(e.into());
            }
        }
        downloaded += chunk.len() as u64;
        emits.update_progress(downloaded).await;
    }
    if let Err(e) = file.flush().await {
        if is_no_space_error(&e) {
            return Err(anyhow::anyhow!("ERR::DISK_FULL"));
        } else {
            return Err(e.into());
        }
    }
    emits.complete().await;
    // DEBUG: fallback single-stream complete size
    // println!("Fallback single-stream download complete. Size: {} bytes", downloaded);
    Ok(())
}

async fn backoff_sleep(attempt: u8) {
    let ms = match attempt {
        0 | 1 => 500,
        2 => 1000,
        3 => 2000,
        _ => 3000,
    };
    tokio::time::sleep(Duration::from_millis(ms)).await;
}
