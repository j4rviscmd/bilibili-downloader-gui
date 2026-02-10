//! Application settings persisted to settings.json

use serde::{Deserialize, Serialize};

/// アプリケーション設定を表す構造体
///
/// settings.json に永続化される設定項目を定義する。
/// すべてのフィールドはオプションで、シリアライズ時に camelCase に変換される。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub struct Settings {
    /// 動画の出力先ディレクトリパス
    #[serde(rename = "dlOutputPath")]
    pub dl_output_path: Option<String>,
    /// UI言語設定
    pub language: Language,
    /// ライブラリのディレクトリパス
    #[serde(rename = "libPath")]
    pub lib_path: Option<String>,
    /// サイドバーの展開状態（true: 展開, false: 折りたたみ）
    #[serde(rename = "sidebarExpanded")]
    pub sidebar_expanded: Option<bool>,
}

/// サポートするUI言語
///
/// アプリケーションでサポートされている言語を列挙する。
/// デフォルトは英語（En）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// 英語
    En,
    /// 日本語
    Ja,
    /// フランス語
    Fr,
    /// スペイン語
    Es,
    /// 中国語
    Zh,
    /// 韓国語
    Ko,
}

impl Default for Language {
    fn default() -> Self {
        Language::En
    }
}
