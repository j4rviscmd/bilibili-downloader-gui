use std::collections::{BTreeMap, HashMap};

use crate::handlers::cookie::read_cookie;
use crate::models::bilibili_api::{
    UserApiResponse, WebInterfaceApiResponse, XPlayerApiResponse, XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{UserData, Video, VideoQuality};
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use reqwest::{
    header::{self},
    Client,
};
use tauri::AppHandle;

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
    let video = Video {
        title: String::new(),
        bvid: id.to_string(),
        cid: 0,
        qualities: Vec::new(),
    };

    let cookies = read_cookie(&app)?;
    if cookies.is_none() {
        return Err("No cookies found".into());
    }
    let cookies = cookies.unwrap();

    let video = fetch_video_title(video, &cookies).await?;
    let video = fetch_video_details(video, &cookies).await?;

    Ok(video)
}

async fn fetch_video_title(mut video: Video, cookies: &[CookieEntry]) -> Result<Video, String> {
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

    video.title = body.data.title;
    video.cid = body.data.cid;

    return Ok(video);
}

async fn fetch_video_details(mut video: Video, cookies: &[CookieEntry]) -> Result<Video, String> {
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
    println!("PlayerApiResponse status: {}", status);
    let body: XPlayerApiResponse = res
        .json::<XPlayerApiResponse>()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;
    // let json_str = serde_json::to_string_pretty(&body).unwrap();
    // println!("PlayerApiResponse body: {}", json_str);

    if body.code != 0 {
        return Err(format!("XPlayerApi error: {}", body.message));
    }

    // id(= quality)毎でグルーピングして、 各アイテムの`codecid`が一番大きいものを選択
    // BTreeMapはキー(id)を常に昇順ソートする
    let mut id_groups: BTreeMap<i8, Vec<XPlayerApiResponseVideo>> = BTreeMap::new();
    for item in &body.data.dash.video {
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
        video.qualities.push(VideoQuality {
            id: item.0.clone(),
            codecid: item.1.codecid,
        });
    }

    return Ok(video);
}
