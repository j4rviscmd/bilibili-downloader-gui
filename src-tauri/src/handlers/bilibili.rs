use crate::constants::REFERER;
use crate::handlers::cookie::read_cookie;
use crate::handlers::ffmpeg::merge_av;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    UserApiResponse, WebInterfaceApiResponse, XPlayerApiResponse, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{Quality, Thumbnail, UserData, Video, VideoPart};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::{
    header::{self},
    Client,
};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

pub async fn download_video(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    filename: &str,
    quality: &i32,
    download_id: String,
    parent_id: Option<String>,
) -> Result<(), String> {
    // --------------------------------------------------
    // 1. 出力ファイルパス決定 + 自動リネーム
    // --------------------------------------------------
    let mut output_path = get_output_path(app, filename).await.map_err(|e| e.to_string())?;
    output_path.set_extension("mp4");
    output_path = auto_rename(&output_path);

    // --------------------------------------------------
    // 2. Cookie チェック
    // --------------------------------------------------
    let cookies = read_cookie(app).map_err(|e| e.to_string())?;
    if cookies.is_none() {
        return Err("ERR::COOKIE_MISSING".into());
    }
    let cookies = cookies.unwrap();
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }

    // --------------------------------------------------
    // 3. 動画詳細取得 (選択品質のURL抽出)
    // --------------------------------------------------
    let details = fetch_video_details(&cookies, bvid, cid).await?;
    let video_item = details
        .data
        .dash
        .video
        .iter()
        .find(|v| v.id == *quality)
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".to_string())?;
    let video_url = video_item.base_url.clone();
    // Audio は first() を利用 (将来拡張予定)
    let audio_url = details
        .data
        .dash
        .audio
        .first()
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".to_string())?
        .base_url
        .clone();

    // --------------------------------------------------
    // 4. 容量事前チェック (取得できなければスキップ)
    // --------------------------------------------------
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 余裕 5MB
        if let Err(e) = ensure_free_space(&output_path, total_needed) {
            return Err(e);
        }
    }

    // --------------------------------------------------
    // 5. temp ファイルパス生成 (download_id ベース)
    // --------------------------------------------------
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", download_id));

    // --------------------------------------------------
    // 6. ダウンロード (リトライ込み)
    // --------------------------------------------------
    // Audio → Video (セマフォ取得)
    let cookie_opt = Some(cookie_header.to_string());

    // Audio DL
    retry_download(|| download_url(
        app,
        audio_url.clone(),
        temp_audio_path.clone(),
        cookie_opt.clone(),
        true,
        Some(download_id.clone()),
    ))
    .await?;

    // Video DL (セマフォ制御)
    let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;
    let video_res = retry_download(|| download_url(
        app,
        video_url.clone(),
        temp_video_path.clone(),
        cookie_opt.clone(),
        true,
        Some(download_id.clone()),
    ))
    .await;
    if let Err(e) = video_res {
        drop(permit); // release permit
        return Err(e);
    }
    // keep permit until merge 完了

    // --------------------------------------------------
    // 7. マージ (merge stage emit)
    // --------------------------------------------------
    // 進捗ステージ更新 (簡易的に emit)
    emit_stage(app, &download_id, "merge");
    if let Err(e) = merge_av(app, &temp_video_path, &temp_audio_path, &output_path, Some(download_id.clone())).await {
        drop(permit);
        return Err("ERR::MERGE_FAILED".into());
    }
    drop(permit);

    // temp 削除
    let _ = tokio::fs::remove_file(&temp_video_path).await;
    let _ = tokio::fs::remove_file(&temp_audio_path).await;

    // 完了イベント (download_url 内 Emits は個別段階で 100% を送っているため最終ステージ通知のみ)
    emit_stage(app, &download_id, "complete");

    Ok(())
}

    // // すでに同名ファイルが存在する場合はエラー
    // if output_path.exists() {
    //     return Err("ERR::FILE_EXISTS".into());
    // }

    // // Get cookies from cache.
    // let cookies = read_cookie(app)?;
    // if cookies.is_none() {
    //     return Err("Cookieが見つかりません".into());
    // }
    // let cookies = &cookies.unwrap();
    // let cookie_header = build_cookie_header(cookies);

    // // baseUrlの抽出
    // let mut video_parts = Vec::<VideoPart>::new();
    // let mut video = Video {
    //     title: filename.to_string(),
    //     bvid: id.to_string(),
    //     parts: video_parts.clone(),
    //     // cid: 0,
    //     // video_qualities: Vec::new(),
    //     // audio_qualities: Vec::new(),
    // };
    // // TODO: fetch_video_infoの呼び出しはしない(Frontendから渡される想定)
    // let res_body1 = fetch_video_title(&video, cookies).await?;
    // res_body1.pages.iter().for_each(|page| {
    //     let mut part = VideoPart {
    //         cid: page.cid,
    //         page: page.page,
    //         part: page.part.clone(),
    //         duration: page.duration,
    //         thumbnail: page.first_frame.clone(),
    //         video_qualities: Vec::new(),
    //         audio_qualities: Vec::new(),
    //     };
    //     video.parts.push(part);
    // });

    // // TODO: fetch_video_detailsの呼び出しはしない(Frontendから渡される想定)
    // let res_body2 = fetch_video_details(&video, cookies).await?;
    // let video_qualities = convert_qualities(&res_body2.data.dash.video);
    // let audio_qualities = convert_qualities(&res_body2.data.dash.audio);
    // // video.video_qualities = video_qualities;
    // // video.audio_qualities = audio_qualities;

    // // // qualityが一致するアイテムを探す
    // let item = video
    //     .video_qualities
    //     .iter()
    //     .find(|q| q.id == *quality)
    //     .ok_or_else(|| format!("指定された画質({})が見つかりません", quality))?;

    // let video_url = res_body2
    //     .data
    //     .dash
    //     .video
    //     .iter()
    //     .find(|v| v.id == item.id)
    //     .ok_or_else(|| format!("指定された画質({})の動画が見つかりません", item.id))?
    //     .base_url
    //     .clone();
    // let audio_url = res_body2.data.dash.audio.first().unwrap().clone().base_url;

    // #[derive(Clone)]
    // struct DlReq {
    //     url: String,
    //     path: PathBuf,
    // }
    // let lib_path = get_lib_path(app);
    // let video_req = DlReq {
    //     url: video_url,
    //     path: lib_path.join("temp_video.m4s"),
    // };
    // let audio_req = DlReq {
    //     url: audio_url,
    //     path: lib_path.join("temp_audio.m4s"),
    // };

    // // ----- 全体リトライ制御 (最大3回) -----
    // let mut attempt: u8 = 0;
    // let max_attempts: u8 = 3;

    // // Acquire and hold a video-level permit across video download + merge
    // let video_permit = loop {
    //     attempt += 1;
    //     // 1) Audio を先にDL
    //     let audio_res = download_url(
    //         app,
    //         audio_req.url.clone(),
    //         audio_req.path.clone(),
    //         Some(cookie_header.to_string()),
    //         true,
    //         download_id.clone(),
    //     )
    //     .await;

    //     if let Err(e) = audio_res {
    //         let msg = e.to_string();
    //         if msg.contains("ERR::FILE_EXISTS") || msg.contains("ERR::DISK_FULL") {
    //             return Err(format!("Download failed: {}", msg));
    //         }
    //         if attempt >= max_attempts {
    //             return Err(format!("Audio download failed after retries: {}", msg));
    //         }
    //         let backoff_ms = 1000u64 * (1u64 << (attempt as u64 - 1)).min(2);
    //         tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
    //         continue; // 次のattempt
    //     }

    //     // 2) Audio成功後に Video をDL
    //     // Acquire global permit to limit concurrent video downloads
    //     let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
    //         .clone()
    //         .acquire_owned()
    //         .await
    //         .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

    //     let video_res = download_url(
    //         app,
    //         video_req.url.clone(),
    //         video_req.path.clone(),
    //         Some(cookie_header.to_string()),
    //         true,
    //         download_id.clone(),
    //     )
    //     .await;

    //     // If video failed, release permit and handle retry
    //     if let Err(e) = video_res {
    //         // release permit immediately
    //         drop(permit);
    //         let msg = e.to_string();
    //         if msg.contains("ERR::FILE_EXISTS") || msg.contains("ERR::DISK_FULL") {
    //             return Err(format!("Download failed: {}", msg));
    //         }
    //         if attempt >= max_attempts {
    //             return Err(format!("Video download failed after retries: {}", msg));
    //         }
    //         let backoff_ms = 1000u64 * (1u64 << (attempt as u64 - 1)).min(2);
    //         tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
    //         // 次 attempt で audio も再DL (シンプルに全体再試行)
    //         continue;
    //     }

    //     // 両方成功, keep permit across merge/cleanup
    //     break permit;
    // };

    // // audio & videoファイルをffmpegで結合
    // merge_av(
    //     app,
    //     &video_req.path,
    //     &audio_req.path,
    //     &output_path,
    //     download_id.clone(),
    // )
    // .await?;

    // // tempファイル削除
    // let _ = fs::remove_file(lib_path.join("temp_video.m4s")).await;
    // let _ = fs::remove_file(lib_path.join("temp_audio.m4s")).await;

    // // Release the video semaphore permit by dropping it
    // // (permit was stored in video_permit)
    // drop(video_permit);

    // Ok(())
}

pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    let mut result: Option<User> = None;

    // 1) メモリキャッシュから Cookie を取得
    let cookies = read_cookie(app)?;
    if cookies.is_none() {
        // DEBUG: println!("No cookies in cache");
        return Ok(result);
    }
    let cookies = cookies.unwrap();

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        // DEBUG: println!("No bilibili cookies found in cache");
        return Ok(result);
    }

    // 3) リクエスト送信（Cookie ヘッダを付与）
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;
    let res: reqwest::Response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;

    let _status = res.status();
    // DEBUG: println!("UserApi Response status: {}", status);
    let body = res
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;
    // println!("Response body: {}", text);

    result = Some(User {
        code: body.code,
        message: body.message,
        data: UserData {
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
    });

    Ok(result)
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

/**
 * URLからBase64エンコード文字列を取得する
 * 1. URLから画像データを取得
 * 2. 画像データをBase64エンコードして返す
 */
async fn base64_encode(url: &str) -> Result<String, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch thumbnail image: {}", e))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read thumbnail image bytes: {}", e))?;
    let encoded = base64::encode(&bytes);
    Ok(encoded)
}

pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    let video_parts = Vec::<VideoPart>::new();
    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: video_parts.clone(),
    };

    let cookies = read_cookie(app)?;
    if cookies.is_none() {
        return Err("No cookies found".into());
    }
    let cookies = cookies.unwrap();

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    video.title = res_body_1.data.title;
    for page in res_body_1.data.pages.iter() {
        let thumb_url = page.first_frame.clone();
        let thumb_base64 = base64_encode(&thumb_url).await.unwrap_or_default();

        let part = VideoPart {
            cid: page.cid,
            page: page.page,
            part: page.part.clone(),
            duration: page.duration,
            thumbnail: Thumbnail {
                url: thumb_url,
                base64: thumb_base64,
            },
            video_qualities: Vec::new(),
            audio_qualities: Vec::new(),
        };
        video.parts.push(part);
    }
    video.parts = video.parts.clone();
    for part in video.parts.iter_mut() {
        // NOTE: partごとに画質情報を取得する必要がある？
        let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
        let video_qualities = convert_qualities(&res_body_2.data.dash.video);
        part.video_qualities = video_qualities;
    }

    // NOTE: Frontendには音質は不要なのでセットしない
    // let audio_qualities = convert_qualities(&res_body2.data.dash.audio);
    // video.audio_qualities = audio_qualities;

    Ok(video)
}

fn convert_qualities(video: &Vec<XPlayerApiResponseVideo>) -> Vec<Quality> {
    let mut res = Vec::<Quality>::new();

    // id(= quality)毎でグルーピングして、 各アイテムの`codecid`が一番大きいものを選択
    // BTreeMapはキー(id)を常に昇順ソートする
    let mut id_groups: BTreeMap<i32, Vec<XPlayerApiResponseVideo>> = BTreeMap::new();
    for item in video {
        id_groups.entry(item.id).or_default().push(item.clone())
    }

    // id毎に最大の codecid を選択
    let mut qualities = BTreeMap::new();
    for (id, items) in id_groups {
        if let Some(max_item) = items.into_iter().max_by_key(|it| it.codecid) {
            qualities.insert(id, max_item);
        }
    }
    // id値の降順で配列格納
    for item in qualities.iter().rev() {
        res.push(Quality {
            id: *item.0,
            codecid: item.1.codecid,
        });
    }

    res
}

async fn fetch_video_title(
    video: &Video,
    cookies: &[CookieEntry],
) -> Result<WebInterfaceApiResponse, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;

    let cookie_header = build_cookie_header(cookies);
    let res: reqwest::Response = client
        .get(format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            video.bvid
        ))
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("WebInterface Api Failed to fetch video info: {e}"))?;

    let _status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("WebInterface Api Failed to read response text: {e}"))?;

    let body: WebInterfaceApiResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("WebInterfaceApi error: {}", body.message));
    }

    Ok(body)
}

async fn fetch_video_details(
    cookies: &[CookieEntry],
    // video: &Video,
    vbid: &str,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("XPlayerApi failed to build client: {e}"))?;

    let cookie_header = build_cookie_header(cookies);
    let res: reqwest::Response = client
        .get("https://api.bilibili.com/x/player/wbi/playurl")
        .header(header::COOKIE, cookie_header)
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&[
            ("bvid", vbid),
            ("cid", cid.to_string().as_str()),
            ("qn", "116"),
            ("fnval", "2064"),
            ("fnver", "0"),
            ("fourk", "1"),
            ("voice_balance", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;

    let _status = res.status();
    let body: XPlayerApiResponse = res
        .json::<XPlayerApiResponse>()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("XPlayerApi error: {}", body.message));
    }

    Ok(body)
}

async fn get_output_path(app: &AppHandle, filename: &str) -> anyhow::Result<PathBuf> {
    if let Ok(settings) = settings::get_settings(app).await {
        let dir = PathBuf::from(&settings.dl_output_path.unwrap());
        Ok(dir.join(filename))
    } else {
        Err(anyhow::anyhow!("Failed to get settings"))
    }
}

// ---- Helper: 自動リネーム (既存ファイルがある場合 filename (n).mp4) ----
fn auto_rename(path: &PathBuf) -> PathBuf {
    let mut candidate = path.clone();
    if !candidate.exists() {
        return candidate;
    }
    let parent = candidate.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let stem = candidate.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = candidate.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    let mut idx = 1u32;
    loop {
        let new_name = format!("{} ({}).{}", stem, idx, ext);
        let new_path = parent.join(new_name);
        if !new_path.exists() {
            return new_path;
        }
        idx += 1;
        if idx > 10_000 { // safety upper bound
            return candidate; // fallback (異常ケース)
        }
    }
}

// ---- Helper: HEAD で Content-Length 取得 ----
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    if let Ok(resp) = req.send().await {
        if let Some(len) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
            if let Ok(s) = len.to_str() {
                if let Ok(v) = s.parse::<u64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

// ---- Helper: 空き容量チェック (単純版) ----
fn ensure_free_space(target_path: &PathBuf, needed_bytes: u64) -> Result<(), String> {
    #[cfg(target_family = "unix")]
    {
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::unix::ffi::OsStrExt;
        use libc::{statvfs, statvfs as statvfs_t};
        let dir = target_path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let c_path = CString::new(dir.as_os_str().as_bytes()).map_err(|_| "ERR::DISK_FULL".to_string())?;
        unsafe {
            let mut stat: MaybeUninit<statvfs_t> = MaybeUninit::uninit();
            if statvfs(c_path.as_ptr(), stat.as_mut_ptr()) != 0 {
                return Ok(()); // 取得失敗はスキップ
            }
            let stat = stat.assume_init();
            let free_bytes = (stat.f_bavail as u64) * (stat.f_frsize as u64);
            if free_bytes <= needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Windows 等未実装 -> スキップ
    Ok(())
}

// ---- Helper: リトライラッパ (最大3回, ネットワーク系のみ) ----
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    let mut attempt: u8 = 0;
    let max_attempts: u8 = 3;
    loop {
        attempt += 1;
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                // ネットワーク/一時的エラーのみ再試行 (雑判定)
                let is_retryable = msg.contains("segment") || msg.contains("request error") || msg.contains("timeout") || msg.contains("connect");
                if attempt >= max_attempts || !is_retryable {
                    return Err(if msg.contains("ERR::") { msg } else { format!("ERR::NETWORK::{msg}") });
                }
                let backoff_ms = 500u64 * (attempt as u64); // 線形簡易
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                continue;
            }
        }
    }
}

// ---- Helper: ステージ変更を簡易発火 (Emits 新規生成) ----
fn emit_stage(app: &AppHandle, download_id: &str, stage: &str) {
    // Emits を新規に生成して stage セット (サイズ不明のため None)
    let emits = crate::emits::Emits::new(app.clone(), download_id.to_string(), None);
    tokio::spawn(async move {
        let _ = emits.set_stage(stage).await;
        if stage == "complete" {
            emits.complete().await;
        }
    });
}
