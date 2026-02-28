//! Application settings persisted to settings.json

use serde::{Deserialize, Serialize};

/// タイトル文字置換ルール
///
/// ファイル名に使用できない文字やテキストを置換するためのマッピング。
/// ユーザーがカスタマイズ可能で、各ルールは有効/無効を切り替えられる。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TitleReplacement {
    /// 置換元の文字またはテキスト
    pub from: String,
    /// 置換先の文字またはテキスト（空文字で削除）
    pub to: String,
    /// ルールが有効かどうか
    pub enabled: bool,
}

impl TitleReplacement {
    /// 新しい置換ルールを作成
    pub fn new(from: impl Into<String>, to: impl Into<String>, enabled: bool) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            enabled,
        }
    }
}

/// デフォルトのタイトル置換ルール
///
/// Windows で禁止されている文字を中心に、一般的な置換を定義。
/// macOS/Linux でも互換性のある文字に置換する。
pub fn default_title_replacements() -> Vec<TitleReplacement> {
    vec![
        TitleReplacement::new("/", "-", true),
        TitleReplacement::new(":", "_", true),
        TitleReplacement::new("*", "x", true),
        TitleReplacement::new("?", "", true),
        TitleReplacement::new("\"", "'", true),
        TitleReplacement::new("<", "(", true),
        TitleReplacement::new(">", ")", true),
        TitleReplacement::new("|", "-", true),
    ]
}

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
    /// タイトル文字置換ルール（設定がない場合はデフォルトを使用）
    #[serde(
        rename = "titleReplacements",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub title_replacements: Option<Vec<TitleReplacement>>,
}

/// サポートするUI言語
///
/// アプリケーションでサポートされている言語を列挙する。
/// デフォルトは英語（En）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// 英語
    #[default]
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
