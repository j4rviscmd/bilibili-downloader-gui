use crate::{
    constants::{REFERER, USER_AGENT},
    emits::Emits,
};
use anyhow::Result;
use reqwest::header;
use std::path::PathBuf;
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
            // Return standardized error code so frontend can localize
            return Err(anyhow::anyhow!("ERR::FILE_EXISTS"));
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
    let emits = Emits::new(app.clone(), filename.to_string(), Some(total_size));
    let mut downloaded: u64 = 0;

    println!("Starting download from: {}", url);
    println!("Destination: {:?}", output_path);
    println!("Total size: {} bytes", total_size);
    while let Some(chunk) = res.chunk().await? {
        file.write_all(&*chunk).await?;
        downloaded += chunk.len() as u64;
        // ダウンロード済みバイトを更新（送信はEmits内部タイマーに任せる）
        emits.update_progress(downloaded).await;
    }
    file.flush().await?;
    emits.complete().await;

    Ok(())
}
