use crate::{
    constants::{REFERER, USER_AGENT},
    emits::Emits,
};
use anyhow::Result;
use reqwest::header;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tokio::{fs, io::AsyncWriteExt};

pub async fn download_url(
    app: &AppHandle,
    url: String,
    output_path: PathBuf,
    cookie: Option<String>,
    is_override: bool,
) -> Result<()> {
    let output_path = &output_path;
    if output_path.exists() {
        if is_override {
            fs::remove_file(output_path).await?;
            println!("Removed existing file: {:?}", output_path);
        } else {
            let msg = format!("ファイルがすでに存在しています: {:?}", output_path);
            return Err(anyhow::anyhow!(msg));
        }
    }

    let url = &url;

    let mut res = if let Some(cookie) = &cookie {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()?
            .get(url)
            .header(header::COOKIE, cookie)
            .header(reqwest::header::REFERER, REFERER)
            .send()
            .await?
    } else {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()?
            .get(url)
            .header(reqwest::header::REFERER, REFERER)
            .send()
            .await?
    };

    let filepath = output_path.parent().unwrap();
    // 拡張子を含まないファイル名を取得
    let filename = output_path.file_stem().unwrap().to_str().unwrap();
    let mut file = tokio::fs::File::create(&output_path).await?;
    println!("Filepath: {:?}", filepath);
    println!("Filename: {:?}", filename);
    println!("File created: {:?}", filepath);

    let total_size = res
        .content_length()
        .ok_or_else(|| anyhow::anyhow!("Content-Length not found"))?;
    println!("Total size: {} bytes", total_size);

    // Frontendへのイベント送信のためのEmitsインスタンスを作成
    let mut emits = Emits::new(app.clone(), filename.to_string(), Some(total_size));
    let mut downloaded: u64 = 0;
    // 最後にフロントへemitした時間（0.1s以上の間隔でemitする）
    let mut last_emit = Instant::now() - Duration::from_millis(100);

    println!("Starting download from: {}", url);
    println!("Destination: {:?}", output_path);
    println!("Total size: {} bytes", total_size);
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&*chunk).await?;
        downloaded += chunk.len() as u64;
        // println!(
        //     "Downloaded {} bytes / {} bytes ({}%)",
        //     downloaded,
        //     total_size,
        //     downloaded * 100 / total_size
        // );
        // 0.1sに1回の割合でイベントを送信
        if last_emit.elapsed() >= Duration::from_millis(100) {
            emits.update_progress(downloaded);
            emits.send_progress();
            last_emit = Instant::now();
        }
    }
    file.flush().await?;
    emits.complete();

    Ok(())
}
