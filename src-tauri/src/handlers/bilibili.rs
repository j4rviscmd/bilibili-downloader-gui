//! Bilibili API 連携モジュール
//!
//! このモジュールはBilibili APIとのすべての相互作用を処理します：
//!
//! ## 主要機能
//!
//! - **動画情報取得**: 動画タイトル、画質オプション、サムネイル等のメタデータ取得
//! - **ユーザー認証**: Firefoxからキャッシュされたクッキーを使用したユーザー情報取得
//! - **動画ダウンロード**: 音声・動画ストリームの並列ダウンロードとffmpegによるマージ
//!
//! ## 並列ダウンロード実装
//!
//! このモジュールは、音声と動画ストリームを同時にダウンロードすることで
//! ダウンロード時間を短縮します。セマフォ (`VIDEO_SEMAPHORE`) を使用して
//! 同時実行数を制限し、システムリソースを保護します。

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
use base64::Engine;
use reqwest::{
    header::{self},
    Client,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Bilibili動画を指定された画質でダウンロードします。
///
/// この関数はダウンロード処理全体をオーケストレーションします：
/// 1. 出力パスの決定と自動リネーム処理
/// 2. Cookieの有無を検証
/// 3. 動画詳細とストリームURLの取得
/// 4. ディスク容量の事前チェック
/// 5. 音声・動画ストリームの並列ダウンロード（リトロジック付き）
/// 6. ffmpegによるストリームのマージ
///
/// 処理の進捗状況はフロントエンドへ随時イベント送信されます。
///
/// # 並列ダウンロードについて
///
/// 音声と動画のストリームを同時にダウンロードすることで、ダウンロード時間を短縮します。
/// セマフォ (VIDEO_SEMAPHORE) を使用して同時実行数を制限し、システムリソースを保護します。
///
/// ## セマフォ制御のライフサイクル
///
/// 1. **取得**: `acquire_owned()` でダウンロード開前にセマフォを取得
/// 2. **並列ダウンロード**: 音声と動画を同時にダウンロード
/// 3. **マージ処理**: ffmpegで音声と動画を結合
/// 4. **解放**: マージ完了後に `drop(permit)` でセマフォを解放
///
/// この設計により、セマフォは「ネットワーク帯域」ではなく「マージ処理の負荷」に
/// 基づいて同時実行数を制限します。
///
/// # 引数
///
/// * `app` - Tauriアプリケーションハンドル
/// * `bvid` - Bilibili動画ID (BV識別子)
/// * `cid` - 動画パートごとのコンテンツID
/// * `filename` - 出力ファイル名（拡張子を除く）
/// * `quality` - 動画画質ID（利用不可の場合は最高画質にフォールバック）
/// * `audio_quality` - 音声画質ID（利用不可の場合は最高画質にフォールバック）
/// * `download_id` - 進捗追跡用の一意識別子
/// * `_parent_id` - マルチパート動画用の親ID（現在未使用）
///
/// # 戻り値
///
/// ダウンロードとマージが成功した場合、`Ok(())` を返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - 設定または出力パスが取得できない
/// - Cookieが存在しない (`ERR::COOKIE_MISSING`)
/// - 選択した画質が利用できない (`ERR::QUALITY_NOT_FOUND`)
/// - ディスク容量が不足している (`ERR::DISK_FULL`)
/// - リトライ回数を超えてダウンロードが失敗 (`ERR::NETWORK`)
/// - ffmpegのマージが失敗 (`ERR::MERGE_FAILED`)
pub async fn download_video(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    filename: &str,
    quality: &i32,
    audio_quality: &i32,
    download_id: String,
    _parent_id: Option<String>,
) -> Result<(), String> {
    // Analytics: mark start
    // NOTE: GA4 Analytics は無効化されています
    // crate::utils::analytics::mark_download_start(&download_id);
    // --------------------------------------------------
    // 1. 出力ファイルパス決定 + 自動リネーム
    // --------------------------------------------------
    let mut output_path = match get_output_path(app, filename).await {
        Ok(p) => p,
        Err(e) => {
            // NOTE: GA4 Analytics は無効化されています
            // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e.to_string())).await;
            return Err(e.to_string());
        }
    };

    // Avoid double extension if user already provided .mp4
    let safe_filename = if filename.to_lowercase().ends_with(".mp4") {
        filename.to_string()
    } else {
        format!("{}.mp4", filename)
    };

    // Get directory from output_path (parent() returns Option<&Path>)
    // and construct final path by joining directory with safe filename
    if let Some(parent) = output_path.parent() {
        output_path = parent.join(&safe_filename);
    } else {
        // Fallback to current directory if parent is None
        output_path = PathBuf::from(&safe_filename);
    }
    output_path = auto_rename(&output_path);

    // --------------------------------------------------
    // 2. Cookie チェック
    // --------------------------------------------------
    let cookies_opt = match read_cookie(app) {
        Ok(c) => c,
        Err(e) => {
            // NOTE: GA4 Analytics は無効化されています
            // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e.to_string())).await;
            return Err(e.to_string());
        }
    };
    if cookies_opt.is_none() {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::COOKIE_MISSING")).await;
        return Err("ERR::COOKIE_MISSING".into());
    }
    let cookies = cookies_opt.unwrap();
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::COOKIE_MISSING")).await;
        return Err("ERR::COOKIE_MISSING".into());
    }

    // --------------------------------------------------
    // 2.5. 設定から速度閾値を取得
    // --------------------------------------------------
    let min_speed_threshold = settings::get_settings(app)
        .await
        .map_err(|e| e.to_string())?
        .download_speed_threshold_mbps;

    // --------------------------------------------------
    // 3. 動画詳細取得 (選択品質のURL抽出)
    // --------------------------------------------------
    let details = fetch_video_details(&cookies, bvid, cid).await?;

    // 選択品質が存在しなければフォールバック (先頭 = 最も高品質)
    let video_url = select_stream_url(
        &details.data.dash.video,
        quality,
        app,
        &download_id,
        "warn-video-quality-fallback",
    )?;
    let audio_url = select_stream_url(
        &details.data.dash.audio,
        audio_quality,
        app,
        &download_id,
        "warn-audio-quality-fallback",
    )?;

    // --------------------------------------------------
    // 4. 容量事前チェック (取得できなければスキップ)
    // --------------------------------------------------
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 余裕 5MB
        ensure_free_space(&output_path, total_needed)?;
    }

    // --------------------------------------------------
    // 5. temp ファイルパス生成 (download_id ベース)
    // --------------------------------------------------
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", download_id));

    // --------------------------------------------------
    // 6. 並列ダウンロード (音声 + 動画)
    // --------------------------------------------------
    //
    // 同時実行制御:
    // - セマフォ (VIDEO_SEMAPHORE) を使用して、同時にダウンロード・マージ処理を実行できる数を制限
    // - セマフォはマージ完了まで保持されるため、並列実行数は「ネットワーク帯域」ではなく「マージ処理の負荷」に基づく
    //
    // 並列実行の利点:
    // - 音声と動画を同時にダウンロードすることで、ネットワーク帯域を有効活用
    // - ダウンロード時間を短縮（逐次実行の場合と比較して最大50%削減可能）
    //
    // エラーハンドリング:
    // - tokio::try_join! により、いずれかのダウンロードが失敗した時点で即座にキャンセル
    // - retry_download によりネットワーク一時エラーの場合は自動再試行（最大3回）
    //
    // セマフォのライフサイクル:
    // 1. acquire_owned() - ダウンロード開始前に取得
    // 2. 並列ダウンロード実行
    // 3. マージ実行
    // 4. drop(permit) - マージ完了後に解放
    //
    // セマフォをマージ完了まで保持
    let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

    let cookie = Some(cookie_header.clone());

    // 並列実行（片方失敗で即時キャンセル）
    if let Err(e) = tokio::try_join!(
        retry_download(|| {
            download_url(
                app,
                audio_url.clone(),
                temp_audio_path.clone(),
                cookie.clone(),
                true,
                Some(download_id.clone()),
                Some(min_speed_threshold),
            )
        }),
        retry_download(|| {
            download_url(
                app,
                video_url.clone(),
                temp_video_path.clone(),
                cookie.clone(),
                true,
                Some(download_id.clone()),
                Some(min_speed_threshold),
            )
        }),
    ) {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some(&e)).await;
        return Err(e);
    }

    // --------------------------------------------------
    // 7. マージ (merge stage emit)
    // --------------------------------------------------
    // merge stage は ffmpeg::merge_av 内で Emits を1つ生成して送信する (重複防止)
    if let Err(_e) = merge_av(
        app,
        &temp_video_path,
        &temp_audio_path,
        &output_path,
        Some(download_id.clone()),
    )
    .await
    {
        // NOTE: GA4 Analytics は無効化されています
        // crate::utils::analytics::finish_download(app, &download_id, false, Some("ERR::MERGE_FAILED")).await;
        return Err("ERR::MERGE_FAILED".into());
    }

    // マージ完了後にセマフォを解放
    // これにより、他の待機中のダウンロードがセマフォを取得可能になる
    drop(permit);

    // temp 削除
    let _ = tokio::fs::remove_file(&temp_video_path).await;
    let _ = tokio::fs::remove_file(&temp_audio_path).await;

    // 完了イベントは ffmpeg::merge_av 内で stage=complete + complete() を送信する
    // NOTE: GA4 Analytics は無効化されています
    // crate::utils::analytics::finish_download(app, &download_id, true, None).await;

    Ok(())
}

/// Bilibiliにログイン中のユーザー情報を取得します。
///
/// Firefoxからキャッシュされたクッキーを使用してユーザープロファイルデータを
/// 取得します。有効なクッキーがない場合は、エラーではなく `None` を返します。
///
/// # 引数
///
/// * `app` - クッキーキャッシュアクセス用Tauriアプリケーションハンドル
///
/// # 戻り値
///
/// ユーザー情報の取得に成功した場合は `Ok(Some(User))`、
/// クッキーがない場合は `Ok(None)` を返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した場合
/// - レスポンスJSONのパースが失敗した場合
pub async fn fetch_user_info(app: &AppHandle) -> Result<Option<User>, String> {
    // 1) メモリキャッシュから Cookie を取得
    let Some(cookies) = read_cookie(app)? else {
        return Ok(None);
    };

    // 2) bilibili 用 Cookie ヘッダを構築
    let cookie_header = build_cookie_header(&cookies);
    if cookie_header.is_empty() {
        return Ok(None);
    }

    // 3) リクエスト送信（Cookie ヘッダを付与）
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;

    let body = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;

    Ok(Some(User {
        code: body.code,
        message: body.message,
        data: UserData {
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
    }))
}

/// クッキーエントリーからCookieヘッダー文字列を構築します。
///
/// bilibili.com ドメイン用のクッキーのみをフィルタリングし、
/// "name=value; name=value" 形式でフォーマットします。
///
/// # 引数
///
/// * `cookies` - クッキーエントリーのスライス
///
/// # 戻り値
///
/// HTTPリクエストで使用可能なフォーマット済みクッキーヘッダー文字列を返します。
///
/// # 実装詳細
///
/// - ホストが "bilibili.com" で終わるクッキーのみを対象とします
/// - セミコロンとスペースで区切って結合します
fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    cookies
        .iter()
        .filter(|c| c.host.ends_with("bilibili.com"))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// URLから画像を取得し、Base64エンコードします。
///
/// 動画サムネイルをダウンロードしてBase64エンコードし、
/// 追加のHTTPリクエストなしでフロントエンドに埋め込むために使用されます。
///
/// # 引数
///
/// * `url` - 取得対象の画像URL
///
/// # 戻り値
///
/// Base64エンコードされた画像データを返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した場合
/// - レスポンスバイトの読み取りが失敗した場合
async fn base64_encode(url: &str) -> Result<String, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch thumbnail image: {}", e))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read thumbnail image bytes: {}", e))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(encoded)
}

/// Bilibili動画の包括的なメタデータを取得します。
///
/// 以下の情報を取得します：
/// - 動画タイトル
/// - すべての動画パート（マルチパート動画の場合）
/// - 動画・音声の利用可能な画質オプション
/// - サムネイル（Base64エンコードされた画像）
/// - 再生時間やその他のメタデータ
///
/// # 引数
///
/// * `app` - クッキーキャッシュアクセス用Tauriアプリケーションハンドル
/// * `id` - Bilibili動画ID (BV識別子)
///
/// # 戻り値
///
/// すべてのメタデータと利用可能な画質オプションを含む `Video` 構造体を返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - クッキーが利用できない場合
/// - APIリクエストが失敗した場合
/// - レスポンスのパースが失敗した場合
pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    let Some(cookies) = read_cookie(app)? else {
        return Err("No cookies found".into());
    };

    let mut video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: Vec::new(),
    };

    let res_body_1 = fetch_video_title(&video, &cookies).await?;
    video.title = res_body_1.data.title;

    for page in res_body_1.data.pages.iter() {
        let thumb_url = page.first_frame.clone();
        let thumb_base64 = base64_encode(&thumb_url).await.unwrap_or_default();

        let mut part = VideoPart {
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

        // partごとに画質情報を取得
        let res_body_2 = fetch_video_details(&cookies, &video.bvid, part.cid).await?;
        part.video_qualities = convert_qualities(&res_body_2.data.dash.video);
        part.audio_qualities = convert_qualities(&res_body_2.data.dash.audio);

        video.parts.push(part);
    }

    Ok(video)
}

/// APIの動画/音声画質データをフロントエンドDTO形式に変換します。
///
/// 画質オプションをIDごとにグルーピングし、各画質レベルで最も高いコーデックを
/// 選択して、降順（最高画質が先頭）でソートして返します。
///
/// # アルゴリズム
///
/// 1. `BTreeMap` を使用して画質ID (`id`) でグルーピング
/// 2. 各グループ内で `codecid` が最大のアイテムを選択
/// 3. 画質IDの降順でベクターに格納
///
/// # 引数
///
/// * `video` - APIから取得した動画/音声画質オプションのスライス
///
/// # 戻り値
///
/// 画質IDで降順ソートされた `Quality` オブジェクトのベクターを返します。
fn convert_qualities(video: &[XPlayerApiResponseVideo]) -> Vec<Quality> {
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

/// Bilibili Web Interface APIから動画タイトルとページ情報を取得します。
///
/// `/x/web-interface/view` エンドポイントを呼び出し、タイトルや
/// マルチパート動画のページ情報などの基本メタデータを取得します。
///
/// # 引数
///
/// * `video` - BVIDを含む動画オブジェクト
/// * `cookies` - Bilibili認証クッキー
///
/// # 戻り値
///
/// 動画タイトルとページ詳細を含むAPIレスポンスを返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した場合
/// - JSONパースが失敗した場合
/// - APIが非ゼロのエラーコードを返した場合
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

/// Bilibili Player APIから動画ストリームURLと画質オプションを取得します。
///
/// `/x/player/wbi/playurl` エンドポイントを呼び出し、動画・音声ストリームの
/// 利用可能な画質と直接ダウンロードURLを取得します。
///
/// # 引数
///
/// * `cookies` - Bilibili認証クッキー
/// * `bvid` - 動画BVID識別子
/// * `cid` - 動画パートごとのコンテンツID
///
/// # 戻り値
///
/// DASH動画/音声ストリームと画質オプションを含むAPIレスポンスを返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した場合
/// - JSONパースが失敗した場合
/// - APIが非ゼロのエラーコードを返した場合
async fn fetch_video_details(
    cookies: &[CookieEntry],
    bvid: &str,
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
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("qn", "116"),
            ("fnval", "2064"),
            ("fnver", "0"),
            ("fourk", "1"),
            ("voice_balance", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;

    let body: XPlayerApiResponse = res
        .json::<XPlayerApiResponse>()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    if body.code != 0 {
        return Err(format!("XPlayerApi error: {}", body.message));
    }

    Ok(body)
}

/// ダウンロードファイルの出力先フルパスを構築します。
///
/// アプリケーション設定からダウンロード出力ディレクトリを読み取り、
/// そこにファイル名を結合します。
///
/// # 引数
///
/// * `app` - 設定アクセス用Tauriアプリケーションハンドル
/// * `filename` - 希望するファイル名（拡張子を除く）
///
/// # 戻り値
///
/// ファイルを保存すべきフルパスを返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - 設定を読み込めない場合
/// - ダウンロードパスが設定されていない場合
async fn get_output_path(app: &AppHandle, filename: &str) -> anyhow::Result<PathBuf> {
    let settings = settings::get_settings(app)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get settings: {}", e))?;
    let output_path = settings
        .dl_output_path
        .ok_or_else(|| anyhow::anyhow!("Download output path is not configured"))?;
    let dir = PathBuf::from(&output_path);
    Ok(dir.join(filename))
}

/// ファイルが既に存在する場合、自動的にリネームします。
///
/// 既存ファイルを上書きしないように、カウンター接尾辞（例: "filename (1).mp4"）を
/// 追加します。10,000個以上の重複が存在する場合は、タイムスタンプベースの命名に
/// フォールバックします。
///
/// # 引数
///
/// * `path` - 元のファイルパス
///
/// # 戻り値
///
/// 既存ファイルと競合しない `PathBuf` を返します。
///
/// # 実装詳細
///
/// - ファイルが存在しない場合は、元のパスをそのまま返します
/// - 1～10,000の範囲で `(数字)` 接尾辞を試行します
/// - すべての重複が存在する場合は、UNIXタイムスタンプ（ミリ秒）を使用します
fn auto_rename(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");

    for idx in 1..=10_000u32 {
        let new_name = format!("{} ({}).{}", stem, idx, ext);
        let new_path = parent.join(new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: use timestamp to ensure uniqueness
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fallback_name = format!("{}_{}.{}", stem, timestamp, ext);
    parent.join(fallback_name)
}

/// HEADリクエストでリソースのContent-Lengthを取得します。
///
/// ダウンロード前にファイルサイズを確認するためにHEADリクエストを送信します。
///
/// # 引数
///
/// * `url` - 確認対象URL
/// * `cookie` - 認証用クッキーヘッダー（オプション）
///
/// # 戻り値
///
/// Content-Lengthが利用可能な場合は `Some(size)`、利用不可能な場合は `None` を返します。
///
/// # エラーハンドリング
///
/// この関数はエラーを伝播せず、失敗した場合に `None` を返します。
/// ネットワークエラーやパースエラーは暗黙的に無視されます。
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    req.send()
        .await
        .ok()?
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

/// ダウンロードに十分なディスク容量が確保されていることを確認します。
///
/// ターゲットファイルシステムの空き容量をチェックし、不足している場合は
/// エラーを返します。現在はUnix系システムのみ実装されています。
/// Windowsおよびその他のプラットフォームではチェックをスキップします。
///
/// # 引数
///
/// * `target_path` - ファイル保存先パス
/// * `needed_bytes` - 必要な総バイト数（安全マージン含む）
///
/// # 戻り値
///
/// 十分な空き容量がある場合、またはチェックを実行できない場合、`Ok(())` を返します。
///
/// # エラー
///
/// 空き容量が必要バイト数以下の場合、`ERR::DISK_FULL` エラーを返します。
///
/// # 実装詳細
///
/// Unix系システムでは `statvfs` システムコールを使用して空き容量を取得します。
/// チェックはベストエフォートベースで行われ、システムコールが失敗した場合は
/// エラーを返さずに処理を継続します。
fn ensure_free_space(target_path: &Path, needed_bytes: u64) -> Result<(), String> {
    #[cfg(target_family = "unix")]
    {
        use libc::statvfs;
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::unix::ffi::OsStrExt;

        let dir = target_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let c_path =
            CString::new(dir.as_os_str().as_bytes()).map_err(|_| "ERR::DISK_FULL".to_string())?;
        unsafe {
            let mut stat = MaybeUninit::<statvfs>::uninit();
            if statvfs(c_path.as_ptr(), stat.as_mut_ptr()) != 0 {
                return Ok(());
            }
            let stat = stat.assume_init();
            let free_bytes = (stat.f_bavail as u64) * stat.f_frsize;
            if free_bytes <= needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Windows 等未実装 -> スキップ
    Ok(())
}

/// ダウンロード操作を最大3回リトライします（リニアバックオフ方式）。
///
/// ダウンロード操作をラップし、ネットワーク関連のエラー（タイムアウト、接続エラー等）
/// が発生した場合に自動的にリトライします。リトライ不可のエラーは即座に返されます。
///
/// バックオフ戦略: 1回目500ms、2回目1000ms、3回目1500ms
///
/// # 型パラメータ
///
/// * `F` - Futureを返すクロージャの型
/// * `Fut` - ダウンロード操作のFuture型
///
/// # 引数
///
/// * `f` - ダウンロード結果を解決するFutureを返すクロージャ
///
/// # 戻り値
///
/// いずれかの試行でダウンロードが成功した場合、`Ok(())` を返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - すべてのリトライ試行が失敗した場合
/// - リトライ不可のエラーが発生した場合（例: ERR::DISK_FULL）
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    const MAX_ATTEMPTS: u8 = 3;

    for attempt in 1..=MAX_ATTEMPTS {
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                // ネットワーク/一時的エラーのみ再試行
                let is_retryable = msg.contains("segment")
                    || msg.contains("request error")
                    || msg.contains("timeout")
                    || msg.contains("connect");

                if attempt >= MAX_ATTEMPTS || !is_retryable {
                    return Err(if msg.contains("ERR::") {
                        msg
                    } else {
                        format!("ERR::NETWORK::{msg}")
                    });
                }

                tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
            }
        }
    }

    unreachable!()
}

/// ストリームURLを画質リストから選択します。
///
/// リクエストされた画質に一致するURLを検索します。見つからない場合は、
/// 最初の要素（最高画質）にフォールバックします。画質リストが空の場合は
/// エラーを返します。
///
/// # 引数
///
/// * `items` - 利用可能な画質のリスト
/// * `quality` - 選択したい画質ID
/// * `app` - Tauriアプリケーションハンドル
/// * `download_id` - ダウンロード識別子
/// * `warn_key` - フォールバック時の警告イベントキー
///
/// # 戻り値
///
/// 選択されたストリームURLを返します。
///
/// # エラー
///
/// 画質リストが空の場合、`ERR::QUALITY_NOT_FOUND` エラーを返します。
fn select_stream_url(
    items: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    quality: &i32,
    app: &AppHandle,
    download_id: &str,
    warn_key: &str,
) -> Result<String, String> {
    items
        .iter()
        .find(|v| v.id == *quality)
        .map(|v| v.base_url.clone())
        .or_else(|| {
            items.first().map(|fb| {
                emit_stage(app, download_id, warn_key);
                fb.base_url.clone()
            })
        })
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into())
}

/// フロントエンドへステージ変更イベントを送信します。
///
/// 新しいEmitsインスタンスを作成し、非同期タスクでステージを設定します。
/// ステージが "complete" の場合は、complete()メソッドも呼び出して進捗を確定します。
///
/// 既存のEmitsインスタンスを管理せずに、簡易的にステージ更新を送信するための
/// ヘルパー関数です。
///
/// # 引数
///
/// * `app` - イベント送信用Tauriアプリケーションハンドル
/// * `download_id` - ダウンロードの一意識別子
/// * `stage` - ステージ名（例: "warn-video-quality-fallback", "complete"）
fn emit_stage(app: &AppHandle, download_id: &str, stage: &str) {
    let emits = crate::emits::Emits::new(app.clone(), download_id.to_string(), None);
    let stage = stage.to_owned();
    tokio::spawn(async move {
        let _ = emits.set_stage(&stage).await;
        if stage == "complete" {
            emits.complete().await;
        }
    });
}
