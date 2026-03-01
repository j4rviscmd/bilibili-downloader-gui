//! Application settings persisted to settings.json

use serde::{Deserialize, Serialize};

/// Title replacement rule for filename sanitization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TitleReplacement {
    pub from: String,
    pub to: String,
    pub enabled: bool,
}

impl TitleReplacement {
    pub fn new(from: impl Into<String>, to: impl Into<String>, enabled: bool) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            enabled,
        }
    }
}

/// Default title replacement rules for Windows-incompatible characters.
///
/// Returns a predefined set of character replacement rules that handle
/// filename restrictions on Windows operating systems. These rules replace
/// characters that are invalid or problematic in Windows filenames.
///
/// # Characters Replaced
///
/// - `/` → `-` (forward slash to hyphen)
/// - `:` → `_` (colon to underscore)
/// - `*` → `x` (asterisk to letter x)
/// - `?` → `` (question mark deleted)
/// - `"` → `'` (double quote to single quote)
/// - `<` → `(` (less than to open paren)
/// - `>` → `)` (greater than to close paren)
/// - `|` → `-` (pipe to hyphen)
///
/// # Examples
///
/// ```
/// let rules = default_title_replacements();
/// assert_eq!(rules.len(), 8);
/// assert!(rules.iter().all(|r| r.enabled));
/// ```
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

/// Application settings persisted to settings.json.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub struct Settings {
    #[serde(rename = "dlOutputPath")]
    pub dl_output_path: Option<String>,
    pub language: Language,
    #[serde(rename = "libPath")]
    pub lib_path: Option<String>,
    #[serde(rename = "sidebarExpanded")]
    pub sidebar_expanded: Option<bool>,
    #[serde(
        rename = "titleReplacements",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub title_replacements: Option<Vec<TitleReplacement>>,
    #[serde(
        rename = "autoRenameDuplicates",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub auto_rename_duplicates: Option<bool>,
}

/// Supported UI languages.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Ja,
    Fr,
    Es,
    Zh,
    Ko,
}
