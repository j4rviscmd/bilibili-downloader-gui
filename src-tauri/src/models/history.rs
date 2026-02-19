//! ダウンロード履歴モデル
//!
//! このモジュールは、永続ストレージでダウンロード済み動画を追跡するための
//! HistoryEntry構造体を定義します。

use serde::{Deserialize, Serialize};

/// ダウンロード履歴エントリ。
///
/// 履歴追跡および検索機能のためのメタデータを含む、
/// 単一のダウンロード済み動画レコードを表します。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// 履歴エントリの一意識別子。
    pub id: String,
    /// Bilibiliから取得した動画タイトル。
    pub title: String,
    /// Bilibili動画ID（BV識別子、後方互換性のために省略可能）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bvid: Option<String>,
    /// Bilibili動画URL。
    pub url: String,
    /// ダウンロード完了タイムスタンプ（ISO 8601形式）。
    pub downloaded_at: String,
    /// ダウンロードステータス: "success" または "failed"。
    pub status: String,
    /// ダウンロード済みファイルサイズ（バイト単位、省略可能）。
    pub file_size: Option<u64>,
    /// 動画品質（例: "1080P60"、省略可能）。
    pub quality: Option<String>,
    /// サムネイルURL（元のBilibili URL）。
    /// フロントエンドはAPI経由でオンデマンドで取得・base64変換します。
    pub thumbnail_url: Option<String>,
    /// データ移行サポート用バージョン。
    #[serde(default = "default_version")]
    pub version: String,
}

/// 新規履歴エントリのデフォルトバージョン文字列を返します。
///
/// バージョンが指定されていない履歴エントリをデシリアライズする際の
/// `version`フィールドのデフォルト値として使用されます。
fn default_version() -> String {
    "1.0".to_string()
}

/// 履歴検索用フィルタ。
///
/// ステータス、品質、日付範囲、テキスト検索によるフィルタリングをサポートします。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilters {
    /// ダウンロードステータスによるフィルタ。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// 日付範囲の開始によるフィルタ（ISO 8601形式）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_from: Option<String>,
}
