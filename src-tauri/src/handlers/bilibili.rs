use crate::constants::REFERER;
use crate::handlers::cookie::read_cookie;
use crate::handlers::ffmpeg::merge_av;
use crate::models::bilibili_api::{
    UserApiResponse, WebInterfaceApiResponse, XPlayerApiResponse, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{Quality, UserData, Video};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_output_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use futures::future::join_all;
use reqwest::{
    header::{self},
    Client,
};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::AppHandle;

pub async fn download_video(
    app: &AppHandle,
    id: &str,
    filename: &str,
    quality: &i32,
) -> Result<(), String> {
    let mut output_path = get_output_path(app, filename);
    output_path.set_extension("mp4");

    // すでに同名ファイルが存在する場合はエラー
    if output_path.exists() {
        return Err("ファイルがすでに存在しています".into());
    }

    // Get cookies from cache.
    let cookies = read_cookie(&app)?;
    if cookies.is_none() {
        return Err("Cookieが見つかりません".into());
    }
    let cookies = &cookies.unwrap();
    let cookie_header = build_cookie_header(cookies);

    // baseUrlの抽出
    let mut video = Video {
        title: filename.to_string(),
        bvid: id.to_string(),
        cid: 0,
        video_qualities: Vec::new(),
        audio_qualities: Vec::new(),
    };
    let res_body1 = fetch_video_title(&video, &cookies).await?;
    video.cid = res_body1.data.cid;

    let res_body2 = fetch_video_details(&video, &cookies).await?;
    let video_qualities = convert_qualities(&res_body2.data.dash.video);
    let audio_qualities = convert_qualities(&res_body2.data.dash.audio);
    video.video_qualities = video_qualities;
    video.audio_qualities = audio_qualities;

    // // qualityが一致するアイテムを探す
    let item = video
        .video_qualities
        .iter()
        .find(|q| q.id == *quality)
        .ok_or_else(|| format!("指定された画質({})が見つかりません", quality))?;

    let video_url = res_body2
        .data
        .dash
        .video
        .iter()
        .find(|v| v.id == item.id)
        .ok_or_else(|| format!("指定された画質({})の動画が見つかりません", item.id))?
        .base_url
        .clone();
    let audio_url = res_body2.data.dash.audio.first().unwrap().clone().base_url;
    let dir_path = output_path.parent().unwrap();

    #[derive(Clone)]
    struct DlReq {
        url: String,
        path: PathBuf,
    }
    let video_req = DlReq {
        url: video_url,
        path: dir_path.join("temp_video.m4s"),
    };
    let audio_req = DlReq {
        url: audio_url,
        path: dir_path.join("temp_audio.m4s"),
    };

    let download_reqs: Vec<DlReq> = vec![video_req.clone(), audio_req.clone()];
    let download_tasks = download_reqs.into_iter().map(|req| {
        download_url(
            app,
            req.url,
            req.path,
            Some(cookie_header.to_string()),
            true,
        )
    });

    // video, audioの両方を並行DL
    let results: Vec<anyhow::Result<()>> = join_all(download_tasks).await;
    for res in results.iter() {
        match res {
            Ok(()) => println!("Download successful"),
            Err(e) => {
                let msg = format!("Download failed: {}", e);
                println!("{}", msg);
                return Err(msg.to_string());
            }
        }
    }

    // audio & videoファイルをffmpegで結合
    merge_av(app, &video_req.path, &audio_req.path, &output_path).await?;

    Ok(())
}

pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    let mut result: Option<User> = None;

    // 1) メモリキャッシュから Cookie を取得
    let cookies = read_cookie(app)?;
    if cookies.is_none() {
        println!("No cookies in cache");
        return Ok(result);
    }
    let cookies = cookies.unwrap();

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        println!("No bilibili cookies found in cache");
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

    let status = res.status();
    println!("UserApi Response status: {}", status);
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

pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        cid: 0,
        video_qualities: Vec::new(),
        audio_qualities: Vec::new(),
    };

    let cookies = read_cookie(&app)?;
    if cookies.is_none() {
        return Err("No cookies found".into());
    }
    let cookies = cookies.unwrap();

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    video.title = res_body_1.data.title;
    video.cid = res_body_1.data.cid;

    let res_body_2 = fetch_video_details(&video, &cookies).await?;
    let video_qualities = convert_qualities(&res_body_2.data.dash.video);
    video.video_qualities = video_qualities;
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
            id: item.0.clone(),
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

    let status = res.status();
    println!("WebInterfaceApiResponse status: {}", status);
    let text = res
        .text()
        .await
        .map_err(|e| format!("WebInterface Api Failed to read response text: {e}"))?;
    // println!("WebInterfaceApiResponse body: {}", text);

    let body: WebInterfaceApiResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("WebInterfaceApi error: {}", body.message));
    }

    return Ok(body);
}

async fn fetch_video_details(
    video: &Video,
    cookies: &[CookieEntry],
) -> Result<XPlayerApiResponse, String> {
    // response codeより利用可能な画質を取得取得し、video.qualitiesに格納
    // quality_dict: dict = {
    //     "1080p60": 116,
    //     "720p60": 74,
    //     "1080p+": 112,
    //     "1080p": 80,
    //     "720p": 64,
    //     "480p": 32,
    //     "360p": 16,
    //     "mp3": 0,
    //     116: "1080p60",
    //     74: "720p60",
    //     112: "1080p+",
    //     80: "1080p",
    //     64: "720p",
    //     32: "480p",
    //     16: "360p",
    // }

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
            ("bvid", video.bvid.as_str()),
            ("cid", video.cid.to_string().as_str()),
            ("qn", "116"),
            ("fnval", "2064"),
            ("fnver", "0"),
            ("fourk", "1"),
            ("voice_balance", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;

    let status = res.status();
    println!("XPlayerApiResponse status: {}", status);

    // // レスポンスをテキストとして全取得
    // let body_text = res
    //     .text()
    //     .await
    //     .map_err(|e| format!("XPlayerApi Failed to read response body: {e}"))?;
    // let body: XPlayerApiResponse = serde_json::from_str(&body_text).unwrap();

    // // JSONを型なしでパース（レスポンスをそのまま持つ）
    // let body_all: serde_json::Value = serde_json::from_str(&body_text)
    //     .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;
    // // 整形して表示
    // let json_str = serde_json::to_string_pretty(&body_all).unwrap();
    // println!("PlayerApiResponse body: \n{}", json_str);

    let body: XPlayerApiResponse = res
        .json::<XPlayerApiResponse>()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("XPlayerApi error: {}", body.message));
    }

    return Ok(body);
}
