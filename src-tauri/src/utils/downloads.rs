use crate::{constants::USER_AGENT, emits::Emits};
use anyhow::Result;
use reqwest::header;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

pub async fn download_url(
    app: &AppHandle,
    url: &str,
    output_path: &PathBuf,
    cookie: Option<&str>,
) -> Result<()> {
    let mut res = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()?
        .get(url)
        .header(header::COOKIE, cookie.unwrap_or_else(|| ""))
        .send()
        .await?;

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
    let mut emits = Emits::new(app.clone(), filename.to_string(), total_size);
    let mut downloaded: u64 = 0;

    println!("Starting download from: {}", url);
    println!("Destination: {:?}", output_path);
    println!("Total size: {} bytes", total_size);
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&*chunk).await?;
        // println!("Downloaded {} bytes", downloaded);
        println!(
            "Downloaded {} bytes / {} bytes ({}%)",
            downloaded,
            total_size,
            downloaded * 100 / total_size
        );
        // TODO: 0.1sに1回の割合でイベントを送信
        emits.update_progress(downloaded);
        emits.send_progress();
        downloaded += chunk.len() as u64;
    }
    emits.complete();

    Ok(())
}
