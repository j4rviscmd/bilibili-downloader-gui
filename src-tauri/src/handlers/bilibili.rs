//! Bilibili API統合モジュール
//!
//! このモジュールはBilibili APIとのすべての相互作用を処理します：
//!
//! ## 主な機能
//!
//! - **動画情報取得**: タイトル、品質オプション、サムネイルを含む動画メタデータの取得
//! - **ユーザー認証**: FirefoxのキャッシュされたCookieを使用したユーザー情報の取得
//! - **動画ダウンロード**: ffmpegでマージされた並列音声/動画ストリームダウンロード
//!

use serde::Deserialize;
use tauri::Emitter;

/// 動画ダウンロードコマンドのダウンロードオプション。
///
/// 過度な関数引数を避けるため、動画パートのダウンロードに必要な
/// すべてのパラメータを単一の構造体にグループ化します。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    /// Bilibili動画ID（BV識別子）
    pub bvid: String,
    /// 特定の動画パートのためのコンテンツID
    pub cid: i64,
    /// 出力ファイル名（拡張子は省略可能、存在しない場合は.mp4が追加されます）
    pub filename: String,
    /// 動画品質ID（利用できない場合は最高品質にフォールバック）
    pub quality: i32,
    /// 音声品質ID（利用できない場合は最高品質にフォールバック）
    pub audio_quality: i32,
    /// このダウンロードを追跡するための一意識別子
    pub download_id: String,
    /// マルチパート動画用の親ダウンロードID（省略可能）
    pub parent_id: Option<String>,
    /// 正確なマージ進捗表示のための動画長（秒単位）
    pub duration_seconds: i64,
    /// このパートのサムネイルURL（省略可能）
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    /// マルチパート動画のページ番号（省略可能）
    #[serde(default)]
    pub page: Option<i32>,
}

use crate::constants::REFERER;
use crate::handlers::cookie::read_cookie;
use crate::handlers::ffmpeg::merge_av;
use crate::handlers::settings;
use crate::models::bilibili_api::{
    UserApiResponse, WatchHistoryApiResponse, WebInterfaceApiResponse, XPlayerApiResponse,
    XPlayerApiResponseVideo,
};
use crate::models::cookie::CookieEntry;
use crate::models::frontend_dto::{
    Quality, Thumbnail, UserData, Video, VideoPart, WatchHistoryCursor, WatchHistoryEntry,
};
use crate::utils::downloads::download_url;
use crate::utils::paths::get_lib_path;
use crate::{constants::USER_AGENT, models::frontend_dto::User};
use base64::Engine;
use reqwest::header;
use reqwest::Client;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// デフォルトのユーザーエージェントを使用してreqwest HTTPクライアントを構築します。
///
/// # 戻り値
///
/// 設定されたHTTPクライアント。
///
/// # エラー
///
/// クライアントビルダーが失敗した場合にエラーを返します。
pub fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build client: {e}"))
}

/// Bilibili APIレスポンスを検証します。
///
/// # 引数
///
/// * `code` - APIレスポンスコード（0 = 成功）
/// * `data` - オプションのデータフィールド参照
///
/// # 戻り値
///
/// レスポンスが有効な場合 `Ok(())`。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - レスポンスコードが非ゼロ
/// - データフィールドがNone
fn validate_api_response<T>(code: i64, data: Option<&T>) -> Result<(), String> {
    if code == -404 {
        return Err("ERR::VIDEO_NOT_FOUND".into());
    }
    if code == -400 || code != 0 {
        return Err("ERR::API_ERROR".into());
    }
    if data.is_none() {
        return Err("ERR::API_ERROR".into());
    }
    Ok(())
}

/// HTTPレスポンスステータスをチェックし、適切なエラーコードを返します。
///
/// # 引数
///
/// * `status` - HTTPレスポンスステータスコード
///
/// # 戻り値
///
/// ステータスが成功（2xx）の場合 `Ok(())`。
///
/// # エラー
///
/// HTTP 429の場合 `ERR::RATE_LIMITED`、その他のエラーの場合 `ERR::API_ERROR` を返します。
fn check_http_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    if status.as_u16() == 429 {
        return Err("ERR::RATE_LIMITED".into());
    }
    Err("ERR::API_ERROR".into())
}

/// 指定された品質設定でBilibili動画をダウンロードします。
///
/// この関数はダウンロードプロセス全体を調整します：
/// 1. 出力パスの決定と自動リネーム処理
/// 2. Cookieの存在検証
/// 3. 動画詳細とストリームURLの取得
/// 4. ディスク容量の事前チェック
/// 5. リトロジック付き並列音声/動画ストリームダウンロード
/// 6. ffmpegによるストリームマージ
///
/// プロセス全体を通じてフロントエンドに進捗更新を送信します。
///
/// # 並列ダウンロード戦略
///
/// 総ダウンロード時間を短縮するため、音声と動画ストリームを同時にダウンロードします。
/// セマフォ（`VIDEO_SEMAPHORE`）が並行性を制限し、システムリソースを保護します。
///
/// ## セマフォライフサイクル
///
/// 1. **取得**: ダウンロード開始前に `acquire_owned()`
/// 2. **並列ダウンロード**: 音声と動画を同時にダウンロード
/// 3. **マージ**: ffmpegが音声と動画を結合
/// 4. **解放**: マージ完了後に `drop(permit)`
///
/// この設計はネットワーク帯域ではなく「マージ負荷」に基づいて並行性を制限します。
///
/// # 引数
///
/// * `app` - Tauriアプリケーションハンドル
/// * `bvid` - Bilibili動画ID（BV識別子）
/// * `cid` - 特定の動画パートのコンテンツID
/// * `filename` - 出力ファイル名（拡張子は省略可能、存在しない場合は.mp4が追加されます）
/// * `quality` - 動画品質ID（利用できない場合は最高品質にフォールバック）
/// * `audio_quality` - 音声品質ID（利用できない場合は最高品質にフォールバック）
/// * `download_id` - このダウンロードを追跡するための一意識別子
/// * `_parent_id` - マルチパート動画用の親ダウンロードID（現在未使用）
///
/// # 戻り値
///
/// ダウンロードとマージが成功した場合、出力ファイルパスを `String` として返します。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - 設定または出力パスを取得できない
/// - Cookieが不足している（`ERR::COOKIE_MISSING`）
/// - 選択された品質が利用できない（`ERR::QUALITY_NOT_FOUND`）
/// - ディスク容量が不足している（`ERR::DISK_FULL`）
/// - リトライ試行後にダウンロードが失敗した（`ERR::NETWORK`）
/// - ffmpegマージが失敗した（`ERR::MERGE_FAILED`）
/// - ダウンロードがキャンセルされた（`ERR::CANCELLED`）
pub async fn download_video(app: &AppHandle, options: &DownloadOptions) -> Result<String, String> {
    use crate::handlers::concurrency::DOWNLOAD_CANCEL_REGISTRY;

    // Register cancellation token for this download
    let _cancel_token = DOWNLOAD_CANCEL_REGISTRY
        .register(&options.download_id)
        .await;

    // 1. 出力ファイルパス決定 + 自動リネーム
    let output_path = auto_rename(&build_output_path(app, &options.filename).await?);

    // 2. Cookie取得（WBI署名により非ログインユーザでも動作）
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    // Cookieヘッダーが空でも続行（WBI署名により画質制限付きでダウンロード可能）

    // 3. 動画詳細取得 (選択品質のURL抽出)
    let details = fetch_video_details(&cookies, &options.bvid, options.cid).await?;

    let dash_data = details
        .data
        .ok_or_else(|| {
            format!(
                "XPlayerApi error (code {}): {} - no data field",
                details.code, details.message
            )
        })?
        .dash;

    // 選択品質が存在しなければフォールバック (先頭 = 最も高品質)
    let (video_url, video_backup_urls) = select_stream_url(&dash_data.video, options.quality)?;
    let (audio_url, audio_backup_urls) =
        select_stream_url(&dash_data.audio, options.audio_quality)?;

    // 5. 容量事前チェック (取得できなければスキップ)
    let video_size = head_content_length(&video_url, Some(&cookie_header)).await;
    let audio_size = head_content_length(&audio_url, Some(&cookie_header)).await;
    if let (Some(vs), Some(asz)) = (video_size, audio_size) {
        let total_needed = vs + asz + (5 * 1024 * 1024); // 余裕 5MB
        ensure_free_space(&output_path, total_needed)?;
    }

    // 6. temp ファイルパス生成
    let lib_path = get_lib_path(app);
    let temp_video_path = lib_path.join(format!("temp_video_{}.m4s", options.download_id));
    let temp_audio_path = lib_path.join(format!("temp_audio_{}.m4s", options.download_id));

    // Result to track success/failure for cleanup
    let result = async {
        // 7. セマフォ取得 + 並列ダウンロード + マージ
        // セマフォは「マージ完了まで保持」され、並列実行数はマージ処理の負荷に基づく
        let permit = crate::handlers::concurrency::VIDEO_SEMAPHORE
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("Failed to acquire video semaphore permit: {}", e))?;

        let cookie = Some(cookie_header);

        // 音声と動画を並列ダウンロード (片方失敗で即時キャンセル)
        tokio::try_join!(
            retry_download(|| {
                download_url(
                    app,
                    audio_url.clone(),
                    audio_backup_urls.clone(),
                    temp_audio_path.clone(),
                    cookie.clone(),
                    true,
                    Some(options.download_id.clone()),
                )
            }),
            retry_download(|| {
                download_url(
                    app,
                    video_url.clone(),
                    video_backup_urls.clone(),
                    temp_video_path.clone(),
                    cookie.clone(),
                    true,
                    Some(options.download_id.clone()),
                )
            }),
        )?;

        // マージ実行 (merge stage emitはffmpeg::merge_av内で送信)
        merge_av(
            app,
            &temp_video_path,
            &temp_audio_path,
            &output_path,
            Some(options.download_id.clone()),
            Some((options.duration_seconds * 1000) as u64), // Convert seconds to milliseconds
        )
        .await
        .map_err(|_| String::from("ERR::MERGE_FAILED"))?;

        // マージ完了後にセマフォを解放
        drop(permit);

        // temp 削除
        let _ = tokio::fs::remove_file(&temp_video_path).await;
        let _ = tokio::fs::remove_file(&temp_audio_path).await;

        // 出力パスを保持 (クローンで履歴保存に渡す)
        let output_path_str = output_path.to_string_lossy().to_string();

        // 実際のファイルサイズを取得
        let actual_file_size = tokio::fs::metadata(&output_path)
            .await
            .ok()
            .map(|m| m.len());

        // 履歴に保存 (非同期で失敗してもダウンロードには影響しない)
        let app = app.clone();
        let bvid = options.bvid.clone();
        let filename = options.filename.clone();
        let quality = options.quality;
        let thumbnail_url = options.thumbnail_url.clone();
        let page = options.page;
        tokio::spawn(async move {
            if let Err(e) = save_to_history(
                &app,
                &bvid,
                quality,
                actual_file_size,
                &filename,
                thumbnail_url,
                page,
            )
            .await
            {
                eprintln!("Warning: Failed to save to history for {bvid}: {e}");
            }
        });

        Ok(output_path_str)
    }
    .await;

    // Cleanup: Remove cancellation token from registry
    DOWNLOAD_CANCEL_REGISTRY.remove(&options.download_id).await;

    // On error, clean up temp files
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_video_path).await;
        let _ = tokio::fs::remove_file(&temp_audio_path).await;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 品質IDの人間可読文字列への変換をテストします。
    ///
    /// 既知の品質IDが期待される表示名を生成し、
    /// 不明なIDが "Q{id}" 形式にフォールバックすることを検証します。
    #[test]
    fn test_quality_to_string() {
        assert_eq!(quality_to_string(&116), "4K");
        assert_eq!(quality_to_string(&112), "1080P60");
        assert_eq!(quality_to_string(&80), "1080P");
        assert_eq!(quality_to_string(&64), "720P");
        assert_eq!(quality_to_string(&32), "480P");
        assert_eq!(quality_to_string(&16), "360P");
        assert_eq!(quality_to_string(&999), "Q999");
    }

    /// すべての既知の品質IDが空でない出力を生成することをテストします。
    ///
    /// quality_to_string関数が空文字列を返さずに
    /// すべてのサポートされる品質レベルを処理することを保証します。
    #[test]
    fn test_quality_to_string_coverage() {
        let known_qualities = [116, 112, 80, 64, 32, 16];
        for q in known_qualities {
            let result = quality_to_string(&q);
            assert!(
                !result.is_empty(),
                "Quality {} should produce non-empty string",
                q
            );
        }
    }
}

/// ダウンロード完了後に履歴エントリを保存します。
///
/// APIから取得したメタデータを含む履歴エントリを作成・永続化します。
/// API取得が失敗した場合はBV IDをタイトルとして使用します。
///
/// # 引数
///
/// * `app` - Tauriアプリケーションハンドル
/// * `bvid` - Bilibili動画ID
/// * `quality` - 動画品質ID
/// * `file_size` - 実際のマージ済みファイルサイズ（バイト単位）
/// * `filename` - ユーザー指定のファイル名（拡張子なし）
/// * `thumbnail_url` - このパートのサムネイルURL（省略可能）
/// * `page` - マルチパート動画のページ番号（省略可能）
async fn save_to_history(
    app: &AppHandle,
    bvid: &str,
    quality: i32,
    file_size: Option<u64>,
    filename: &str,
    thumbnail_url: Option<String>,
    page: Option<i32>,
) -> Result<(), Box<dyn std::error::Error>> {
    use crate::models::history::HistoryEntry;
    use crate::store::HistoryStore;
    use chrono::Utc;
    use std::path::Path;

    let title = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string();

    let thumbnail_url = match thumbnail_url {
        Some(url) => Some(url),
        None => {
            let cookies = read_cookie(app)?.unwrap_or_default();
            fetch_video_info_for_history(bvid, &cookies)
                .await
                .and_then(|(_, url)| url)
        }
    };

    let page_suffix = page.map_or(String::new(), |p| format!("?p={p}"));

    let url = format!("https://www.bilibili.com/video/{bvid}{page_suffix}");

    let id = format!(
        "{bvid}_{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let entry = HistoryEntry {
        id,
        title,
        bvid: Some(bvid.to_string()),
        url,
        downloaded_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        status: "completed".to_string(),
        file_size,
        quality: Some(quality_to_string(&quality)),
        thumbnail_url,
        version: "1.0".to_string(),
    };

    HistoryStore::new(app)?.add_entry(entry.clone())?;

    // Emit event to notify frontend of new history entry
    let _ = app.emit("history:entry_added", &entry);

    Ok(())
}

/// Converts quality ID to human-readable string representation.
fn quality_to_string(quality: &i32) -> String {
    match quality {
        116 => "4K".to_string(),
        112 => "1080P60".to_string(),
        80 => "1080P".to_string(),
        64 => "720P".to_string(),
        32 => "480P".to_string(),
        16 => "360P".to_string(),
        _ => format!("Q{quality}"),
    }
}

/// 履歴エントリ用の動画情報を取得します（失敗時にNoneを返します）。
///
/// Bilibili APIから動画タイトルの取得を試みます。
/// 履歴エントリ作成時に内部的に使用されます。
///
/// # 引数
///
/// * `bvid` - Bilibili動画ID
/// * `cookies` - 認証Cookie
///
/// # 戻り値
///
/// 成功時 `(title, thumbnail_url)`、失敗時 `None` を返します。
async fn fetch_video_info_for_history(
    bvid: &str,
    cookies: &[CookieEntry],
) -> Option<(String, Option<String>)> {
    let client = build_client().ok()?;
    let cookie_header = build_cookie_header(cookies);
    let url = format!("https://api.bilibili.com/x/web-interface/view?bvid={bvid}");

    let response = client
        .get(url)
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .ok()?;
    check_http_status(response.status()).ok()?;
    let body: WebInterfaceApiResponse = response.json().await.ok()?;

    let data = body.data?;
    let thumbnail_url = if data.pic.is_empty() {
        None
    } else {
        Some(data.pic)
    };
    Some((data.title, thumbnail_url))
}

/// Bilibiliからログインユーザー情報を取得します。
///
/// FirefoxのキャッシュされたCookieを使用してユーザープロフィールデータを取得します。
/// 常に `has_cookie` でCookieステータスを示すUserオブジェクトを返します。
///
/// # 引数
///
/// * `app` - CookieキャッシュにアクセスするためのTauriアプリケーションハンドル
///
/// # 戻り値
///
/// Cookieの可用性に基づいて `has_cookie` が設定された `Ok(User)`。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した（Cookieが利用可能な場合）
/// - レスポンスJSONの解析が失敗した（Cookieが利用可能な場合）
pub async fn fetch_user_info(app: &AppHandle) -> Result<User, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let has_cookie = !cookie_header.is_empty();

    if !has_cookie {
        return Ok(User {
            code: 0,
            message: String::new(),
            data: UserData {
                mid: None,
                uname: None,
                is_login: false,
            },
            has_cookie: false,
        });
    }

    let client = build_client()?;
    let response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {e}"))?;
    check_http_status(response.status())?;
    let body = response
        .json::<UserApiResponse>()
        .await
        .map_err(|e| format!("UserApi Failed to parse response JSON:: {e}"))?;

    Ok(User {
        code: body.code,
        message: body.message,
        data: UserData {
            mid: body.data.mid,
            uname: body.data.uname,
            is_login: body.data.is_login,
        },
        has_cookie: true,
    })
}

/// CookieエントリからCookieヘッダー文字列を構築します。
///
/// bilibili.comドメインのCookieをフィルタリングし、
/// "name=value; name=value" 形式でフォーマットします。
///
/// # 引数
///
/// * `cookies` - Cookieエントリのスライス
///
/// # 戻り値
///
/// HTTPリクエストで使用可能なフォーマット済みCookieヘッダー文字列。
///
/// # 実装詳細
///
/// - ホストが "bilibili.com" で終わるCookieのみを含める
/// - セミコロンとスペース区切りでエントリを結合する
fn build_cookie_header(cookies: &[CookieEntry]) -> String {
    cookies
        .iter()
        .filter(|c| c.host.ends_with("bilibili.com"))
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// キャッシュされたCookieからCookieヘッダー文字列を構築します。
///
/// アプリのCookieキャッシュからCookieを読み取り、
/// HTTPリクエスト用にフォーマットする便利関数です。
///
/// # 引数
///
/// * `app` - CookieキャッシュにアクセスするためのTauriアプリケーションハンドル
///
/// # 戻り値
///
/// HTTPリクエストで使用可能なフォーマット済みCookieヘッダー文字列。
///
/// # エラー
///
/// Cookieキャッシュにアクセスできない場合にエラーを返します。
pub fn build_cookie_header_from_cache(app: &AppHandle) -> Result<String, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let header = build_cookie_header(&cookies);
    if header.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }
    Ok(header)
}

/// URLから画像を取得しBase64エンコードします。
///
/// 動画サムネイルをダウンロードしてBase64エンコードし、
/// 追加のHTTPリクエストなしでフロントエンドに埋め込みます。
///
/// # 引数
///
/// * `url` - 取得する画像URL
///
/// # 戻り値
///
/// データURIプレフィックス付きのBase64エンコード画像データ。
///
/// # エラー
///
/// HTTPリクエストが失敗した場合、またはレスポンス読み取りが失敗した場合にエラーを返します。
pub async fn get_thumbnail_base64(url: &str) -> Result<String, String> {
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch thumbnail image: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read thumbnail image bytes: {e}"))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

/// Bilibiliから包括的な動画メタデータを取得します。
///
/// 以下を取得します：
/// - 動画タイトル
/// - すべての動画パート（マルチパート動画の場合）
/// - 利用可能な動画/音声品質オプション
/// - サムネイル（Base64エンコード画像）
/// - 長さその他のメタデータ
///
/// # 引数
///
/// * `app` - CookieキャッシュにアクセスするためのTauriアプリケーションハンドル
/// * `id` - Bilibili動画ID（BV識別子）
///
/// # 戻り値
///
/// すべてのメタデータと利用可能な品質オプションを含む `Video` 構造体。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - Cookieが利用できない
/// - APIリクエストが失敗した
/// - レスポンス解析が失敗した
pub async fn fetch_video_info(app: &AppHandle, id: &str) -> Result<Video, String> {
    let cookies = read_cookie(app)?.unwrap_or_default();
    let cookie_header = build_cookie_header(&cookies);
    let is_limited_quality = cookie_header.is_empty();

    let video = Video {
        title: String::new(),
        bvid: id.to_string(),
        parts: Vec::new(),
        is_limited_quality,
    };

    let res_body = fetch_video_title(&video, &cookies).await?;
    let data = res_body.data.as_ref().unwrap();

    let pages = data.pages.as_deref().unwrap_or(&[]);
    let bvid = &video.bvid;

    if pages.is_empty() {
        let details = fetch_video_details(&cookies, bvid, data.cid).await?;
        let dash_data = details.data.unwrap().dash;

        let part = VideoPart {
            cid: data.cid,
            page: 1,
            part: data.title.clone(),
            duration: 0,
            thumbnail: Thumbnail {
                url: data.pic.clone(),
                base64: get_thumbnail_base64(&data.pic).await.unwrap_or_default(),
            },
            video_qualities: convert_qualities(&dash_data.video),
            audio_qualities: convert_qualities(&dash_data.audio),
        };

        return Ok(Video {
            title: data.title.clone(),
            parts: vec![part],
            ..video
        });
    }

    let mut parts = Vec::with_capacity(pages.len());
    for page in pages {
        let details = fetch_video_details(&cookies, bvid, page.cid).await?;
        let dash_data = details.data.unwrap().dash;

        let thumb_url = page.first_frame.as_deref().unwrap_or_default();
        let thumb_base64 = if thumb_url.is_empty() {
            String::new()
        } else {
            get_thumbnail_base64(thumb_url).await.unwrap_or_default()
        };

        parts.push(VideoPart {
            cid: page.cid,
            page: page.page,
            part: page.part.clone(),
            duration: page.duration,
            thumbnail: Thumbnail {
                url: thumb_url.into(),
                base64: thumb_base64,
            },
            video_qualities: convert_qualities(&dash_data.video),
            audio_qualities: convert_qualities(&dash_data.audio),
        });
    }

    Ok(Video {
        title: data.title.clone(),
        parts,
        ..video
    })
}

/// API動画/音声品質データをフロントエンドDTO形式に変換します。
///
/// 品質オプションをIDごとにグループ化し、各品質レベルで最も高いコーデックを選択し、
/// 降順（最高品質が先頭）でソートして返します。
///
/// # 引数
///
/// * `video` - APIからの動画/音声品質オプションのスライス
///
/// # 戻り値
///
/// 品質IDの降順でソートされた `Quality` オブジェクトのベクタ。
///
/// # 例
///
/// ```
/// # use crate::models::bilibili_api::XPlayerApiResponseVideo;
/// # use crate::handlers::bilibili::convert_qualities;
/// # use crate::models::frontend_dto::Quality;
/// // 品質ごとに複数のコーデックオプションを持つAPIレスポンスの場合：
/// // - 品質80: コーデック7（AVC）と12（HEVC）
/// // - 品質64: コーデック7（AVC）
/// // この関数は各品質で最も高いコーデックを選択します（12 > 7）
/// let api_qualities = vec![
///     XPlayerApiResponseVideo { id: 80, codecid: 7, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
///     XPlayerApiResponseVideo { id: 80, codecid: 12, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
///     XPlayerApiResponseVideo { id: 64, codecid: 7, bandwidth: 0, width: 0, height: 0, base_url: String::new() },
/// ];
/// let result = convert_qualities(&api_qualities);
/// // 品質がソートされて返されます：[80（コーデック12）、64（コーデック7）]
/// assert_eq!(result[0].id, 80);
/// assert_eq!(result[0].codecid, 12); // 最高コーデックが選択される
/// assert_eq!(result[1].id, 64);
/// ```
fn convert_qualities(video: &[XPlayerApiResponseVideo]) -> Vec<Quality> {
    let mut qualities: BTreeMap<i32, &XPlayerApiResponseVideo> = BTreeMap::new();

    for item in video {
        qualities
            .entry(item.id)
            .and_modify(|existing| {
                if item.codecid > existing.codecid {
                    *existing = item;
                }
            })
            .or_insert(item);
    }

    qualities
        .into_iter()
        .rev()
        .map(|(id, v)| Quality {
            id,
            codecid: v.codecid,
        })
        .collect()
}

/// Bilibili Web Interface APIから動画タイトルとページ情報を取得します。
///
/// `/x/web-interface/view` エンドポイントを呼び出し、タイトルや
/// マルチパート動画のページ情報を含む基本メタデータを取得します。
///
/// # 引数
///
/// * `video` - BVIDを含む動画オブジェクト
/// * `cookies` - Bilibili認証Cookie
///
/// # 戻り値
///
/// 動画タイトルとページ詳細を含むAPIレスポンス。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した
/// - JSON解析が失敗した
/// - APIが非ゼロのエラーコードを返した
async fn fetch_video_title(
    video: &Video,
    cookies: &[CookieEntry],
) -> Result<WebInterfaceApiResponse, String> {
    let client = build_client()?;
    let url = format!(
        "https://api.bilibili.com/x/web-interface/view?bvid={}",
        video.bvid
    );

    let response = client
        .get(url)
        .header(header::COOKIE, build_cookie_header(cookies))
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("WebInterface Api Failed to fetch video info: {e}"))?;
    check_http_status(response.status())?;
    let body: WebInterfaceApiResponse = response
        .json()
        .await
        .map_err(|e| format!("WebInterface Api Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
    Ok(body)
}

/// Bilibili Player APIから動画ストリームURLと品質オプションを取得します。
///
/// `/x/player/wbi/playurl` エンドポイントを呼び出し、利用可能な品質と
/// DASH動画/音声ストリームの直接ダウンロードURLを取得します。
///
/// # 引数
///
/// * `cookies` - Bilibili認証Cookie
/// * `bvid` - 動画BVID識別子
/// * `cid` - 特定の動画パートのコンテンツID
///
/// # 戻り値
///
/// DASH動画/音声ストリームと品質オプションを含むAPIレスポンス。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - HTTPリクエストが失敗した
/// - JSON解析が失敗した
/// - APIが非ゼロのエラーコードを返した
async fn fetch_video_details(
    cookies: &[CookieEntry],
    bvid: &str,
    cid: i64,
) -> Result<XPlayerApiResponse, String> {
    let client = build_client()?;
    let mixin_key = crate::utils::wbi::fetch_mixin_key(&client).await?;

    let mut params = BTreeMap::from([
        ("bvid".to_string(), bvid.to_string()),
        ("cid".to_string(), cid.to_string()),
        ("qn".to_string(), "116".to_string()),
        ("fnval".to_string(), "2064".to_string()),
        ("fnver".to_string(), "0".to_string()),
        ("fourk".to_string(), "1".to_string()),
    ]);

    let signature = crate::utils::wbi::generate_wbi_signature(&mut params, &mixin_key)?;

    let response = client
        .get("https://api.bilibili.com/x/player/wbi/playurl")
        .header(header::COOKIE, build_cookie_header(cookies))
        .header(header::REFERER, "https://www.bilibili.com")
        .query(&[
            ("bvid", bvid),
            ("cid", &cid.to_string()),
            ("qn", "116"),
            ("fnval", "2064"),
            ("fnver", "0"),
            ("fourk", "1"),
            ("w_rid", &signature.w_rid),
            ("wts", &signature.wts),
        ])
        .send()
        .await
        .map_err(|e| format!("XPlayerApi Failed to fetch video info: {e}"))?;
    check_http_status(response.status())?;
    let body: XPlayerApiResponse = response
        .json()
        .await
        .map_err(|e| format!("XPlayerApi Failed to parse response JSON: {e}"))?;

    validate_api_response(body.code, body.data.as_ref())?;
    Ok(body)
}

/// ファイルが既に存在する場合に自動的にリネームします。
///
/// 既存ファイルを上書きしないようにカウンター接尾辞（例: "filename (1).mp4"）を追加します。
/// 10,000個以上の重複が存在する場合、タイムスタンプベースの命名にフォールバックします。
///
/// # 引数
///
/// * `path` - 元のファイルパス
///
/// # 戻り値
///
/// 既存ファイルと競合しない `PathBuf`。
///
/// # 実装詳細
///
/// - ファイルが存在しない場合は元のパスを返す
/// - 1から10,000までの `(number)` 接尾辞を試す
/// - すべての重複が存在する場合はUNIXタイムスタンプ（ミリ秒）を使用する
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

/// ダウンロードファイルの完全な出力パスを構築します。
///
/// アプリケーション設定からダウンロード出力ディレクトリを読み取り、
/// ファイル名を追加します。`.mp4`拡張子が存在することを保証します。
///
/// # 引数
///
/// * `app` - 設定にアクセスするためのTauriアプリケーションハンドル
/// * `filename` - 希望するファイル名（拡張子は省略可能、存在しない場合は.mp4が追加されます）
///
/// # 戻り値
///
/// ファイルを保存するべき完全なパス。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - 設定をロードできない
/// - ダウンロードパスが設定されていない
async fn build_output_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let settings = settings::get_settings(app)
        .await
        .map_err(|e| format!("Failed to get settings: {e}"))?;
    let output_path = settings
        .dl_output_path
        .ok_or_else(|| "Download output path is not configured".to_string())?;

    let filename_with_ext = if filename.to_lowercase().ends_with(".mp4") {
        filename.to_string()
    } else {
        format!("{filename}.mp4")
    };

    Ok(PathBuf::from(&output_path).join(filename_with_ext))
}

/// HEADリクエストでリソースのContent-Lengthを取得します。
///
/// ダウンロード前にファイルサイズを確認するためにHEADリクエストを送信します。
/// ディスク容量検証に使用されるベストエフォートチェックです。
///
/// # 引数
///
/// * `url` - チェックするURL
/// * `cookie` - オプションの認証Cookieヘッダー
///
/// # 戻り値
///
/// Content-Lengthが利用可能な場合は `Some(size)`、それ以外は `None`。
///
/// # エラーハンドリング
///
/// エラーを伝播せず、失敗時に `None` を返します。
/// ネットワークと解析エラーは黙って無視されます。
/// HTTPステータスが200 OKの場合のみContent-Lengthを返します。
///
/// # 例
///
/// ```ignore
/// let size = head_content_length(&video_url, Some(&cookie_header)).await;
/// if let Some(bytes) = size {
///     println!("File size: {} bytes", bytes);
/// }
/// ```
async fn head_content_length(url: &str, cookie: Option<&String>) -> Option<u64> {
    let client = reqwest::Client::builder().build().ok()?;
    let mut req = client.head(url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }
    let response = req.send().await.ok()?;

    // Only accept successful responses (200 OK)
    if !response.status().is_success() {
        // HEAD request may fail (e.g., 403 Forbidden) but download continues normally
        // eprintln!("HEAD request failed for {}: {}", url, response.status());
        return None;
    }

    response
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

/// ダウンロードに十分なディスク容量があることを保証します。
///
/// ターゲットファイルシステムの空き容量をチェックし、不足している場合にエラーを返します。
/// 現在、Unix風システムのみ実装されています。Windowsおよびその他のプラットフォームではスキップされます。
///
/// # 引数
///
/// * `target_path` - ファイル保存先パス
/// * `needed_bytes` - 必要な総バイト数（安全マージンを含む）
///
/// # 戻り値
///
/// 十分な空き容量がある場合、またはチェックを実行できない場合 `Ok(())`。
///
/// # エラー
///
/// 空き容量が必要バイト数未満の場合 `ERR::DISK_FULL` エラーを返します。
///
/// # 実装詳細
///
/// Unix風システムで `statvfs` システムコールを使用して空き容量を取得します。
/// チェックはベストエフォートであり、システムコールが失敗してもエラーなしで継続します。
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
            #[allow(clippy::unnecessary_cast)]
            #[allow(clippy::useless_conversion)]
            let free_bytes = u64::from(stat.f_bavail) * stat.f_frsize;
            if free_bytes <= needed_bytes {
                return Err("ERR::DISK_FULL".into());
            }
        }
    }
    // Windows 等未実装 -> スキップ
    Ok(())
}

/// 線形バックオフで最大3回ダウンロード操作をリトライします。
///
/// ダウンロード操作をラップし、ネット関連エラー
/// （タイムアウト、接続エラーなど）で自動的にリトライします。
/// リトライ不可能なエラーは即座に返されます。
///
/// バックオフ戦略: 500ms、1000ms、1500ms
///
/// # 型パラメータ
///
/// * `F` - Futureを返すクロージャ型
/// * `Fut` - ダウンロード操作用のFuture型
///
/// # 引数
///
/// * `f` - ダウンロード結果に解決されるFutureを返すクロージャ
///
/// # 戻り値
///
/// いずれかの試行でダウンロードが成功した場合 `Ok(())`。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - すべてのリトライ試行が失敗した
/// - リトライ不可能なエラーが発生した（例: ERR::DISK_FULL）
async fn retry_download<F, Fut>(mut f: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    const MAX_ATTEMPTS: u8 = 3;
    const RETRYABLE_KEYWORDS: &[&str] = &["segment", "request error", "timeout", "connect"];

    for attempt in 1..=MAX_ATTEMPTS {
        match f().await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let msg = e.to_string();
                let is_retryable = RETRYABLE_KEYWORDS.iter().any(|&kw| msg.contains(kw));

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

    Err("ERR::NETWORK::All retry attempts failed".to_string())
}

/// 品質リストからストリームURLを選択します。
///
/// リクエストされた品質に一致するURLを検索します。
/// 見つからない場合は最初の要素（最高品質）にフォールバックします。
/// 品質リストが空の場合はエラーを返します。
///
/// # 引数
///
/// * `items` - 利用可能な品質オプションのリスト
/// * `quality` - 選択する希望品質ID
///
/// # 戻り値
///
/// 選択されたストリームURL。
///
/// # エラー
///
/// 品質リストが空の場合 `ERR::QUALITY_NOT_FOUND` エラーを返します。
///
/// # 例
///
/// ```ignore
/// let url = select_stream_url(&dash_data.video, 80)?; // 1080Pをリクエスト
/// // 80が利用できない場合は最高品質にフォールバック
/// ```
fn select_stream_url(
    items: &[crate::models::bilibili_api::XPlayerApiResponseVideo],
    quality: i32,
) -> Result<(String, Option<Vec<String>>), String> {
    items
        .iter()
        .find(|v| v.id == quality)
        .or_else(|| items.first())
        .map(|v| (v.base_url.clone(), v.backup_urls.clone()))
        .ok_or_else(|| "ERR::QUALITY_NOT_FOUND".into())
}

/// 視聴履歴APIのレスポンス構造体。
///
/// 履歴エントリのリストとページネーションカーソルを含みます。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryResponse {
    pub entries: Vec<WatchHistoryEntry>,
    pub cursor: WatchHistoryCursor,
}

/// Bilibili APIから視聴履歴を取得します。
///
/// ページネーションサポート付きでユーザーの視聴履歴を取得します。
/// 認証には有効なBilibili Cookieが必要です。
///
/// # 引数
///
/// * `app` - CookieキャッシュにアクセスするためのTauriアプリケーションハンドル
/// * `max` - 取得するエントリの最大数（0はデフォルト）
/// * `view_at` - ページネーション用タイムスタンプカーソル（0は先頭ページ）
///
/// # 戻り値
///
/// 履歴エントリと次のカーソルを含む `WatchHistoryResponse`。
///
/// # エラー
///
/// 以下の場合にエラーを返します：
/// - Cookieが利用できない（`ERR::COOKIE_MISSING`）
/// - ユーザーがログインしていない（`ERR::UNAUTHORIZED`、APIコード-101）
/// - HTTPリクエストが失敗した
/// - レスポンス解析が失敗した
pub async fn fetch_watch_history(
    app: &AppHandle,
    max: i32,
    view_at: i64,
) -> Result<WatchHistoryResponse, String> {
    // 1. Cookie取得（必須）
    let cookies = read_cookie(app)?.unwrap_or_default();

    if cookies.is_empty() {
        return Err("ERR::COOKIE_MISSING".into());
    }

    let cookie_header = build_cookie_header(&cookies);

    // 2. API呼び出し
    // 初回リクエストではパラメータを省略、2回目以降はmax/view_atを使用
    let client = build_client()?;
    let url = if max == 0 && view_at == 0 {
        "https://api.bilibili.com/x/web-interface/history/cursor?business=archive".to_string()
    } else {
        format!(
            "https://api.bilibili.com/x/web-interface/history/cursor?max={}&view_at={}&business=archive",
            max, view_at
        )
    };

    let response = client
        .get(&url)
        .header(header::COOKIE, cookie_header)
        .header(reqwest::header::REFERER, REFERER)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch watch history: {e}"))?;

    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response text: {e}"))?;

    let body: WatchHistoryApiResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Failed to parse watch history response: {e}. Response: {}",
            response_text
        )
    })?;

    // 3. エラーハンドリング（-101: 未ログイン）
    if body.code == -101 {
        return Err("ERR::UNAUTHORIZED".into());
    }

    if body.code != 0 {
        return Err(format!(
            "Watch history API error (code {}): {}",
            body.code, body.message
        ));
    }

    let data = body
        .data
        .ok_or_else(|| "Watch history API returned no data".to_string())?;

    // 4. DTO変換（サムネイルを並列でBase64エンコード）
    let entry_futures: Vec<_> = data
        .list
        .into_iter()
        .map(|item| {
            let url = if item.history.page > 1 {
                format!(
                    "https://www.bilibili.com/video/{}?p={}",
                    item.history.bvid, item.history.page
                )
            } else {
                format!("https://www.bilibili.com/video/{}", item.history.bvid)
            };

            async move {
                let cover_base64 = get_thumbnail_base64(&item.cover).await.unwrap_or_default();
                WatchHistoryEntry {
                    title: item.title,
                    cover: item.cover,
                    cover_base64,
                    bvid: item.history.bvid,
                    cid: item.history.cid,
                    page: item.history.page,
                    view_at: item.view_at,
                    duration: item.duration,
                    progress: item.progress,
                    url,
                }
            }
        })
        .collect();

    let entries = futures::future::join_all(entry_futures).await;

    let cursor = WatchHistoryCursor {
        view_at: data.cursor.view_at,
        max: data.cursor.max,
        is_end: data.cursor.is_end,
    };

    Ok(WatchHistoryResponse { entries, cursor })
}
