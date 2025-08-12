use crate::models::{CookieCache, CookieEntry, User};
use reqwest::{header, Client};
use tauri::{AppHandle, Manager};

pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    // 1) メモリキャッシュから Cookie を取得
    let Some(cache) = app.try_state::<CookieCache>() else {
        println!("No CookieCache state found");
        return Ok(None);
    };
    let cookies = match cache.cookies.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return Err("failed to lock cookie cache".to_string()),
    };
    if cookies.is_empty() {
        println!("No cookies in cache");
        return Ok(None);
    }

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        println!("No bilibili cookies found in cache");
        return Ok(None);
    }

    // 3) リクエスト送信（Cookie ヘッダを付与）
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari")
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;
    let res: reqwest::Response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;

    let status = res.status();
    println!("Response status: {}", status);
    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response text: {e}"))?;
    println!("Response body: {}", text);
    let user: User =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response JSON: {e}"))?;

    Ok(Some(user))
}

fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    // bilibili ドメインのものに限定しつつ name=value; を組み立て
    let mut parts: Vec<String> = Vec::new();
    for c in cookies {
        if c.host.ends_with("bilibili.com") {
            // 値にセミコロンや改行が入らない前提。必要ならサニタイズ。
            parts.push(format!("{}={}", c.name, c.value));
        }
    }
    parts.join("; ")
}

// TODO: Implements
pub async fn fetch_video_info(app: &AppHandle) -> Result<bool, String> {
    // ここにビリビリの動画情報を取得する処理を実装
    // 例えば、APIを呼び出して動画情報を取得するなど
    // 成功した場合は Ok(true) を返す
    // 失敗した場合は Err("エラーメッセージ") を返す

    // ダミーの実装
    println!("Fetching video info...");
    Ok(true)
}
