//! Application settings persisted to settings.json

use serde::{Deserialize, Serialize};

/// Title replacement rule for filename sanitization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TitleReplacement {
    /// Character or text to match for replacement.
    pub from: String,
    /// Replacement text. Use an empty string to delete the match.
    pub to: String,
    /// Whether this replacement rule is active.
    pub enabled: bool,
}

impl TitleReplacement {
    /// Creates a new title replacement rule.
    ///
    /// # Arguments
    ///
    /// * `from` - The character or text to match for replacement.
    /// * `to` - The replacement text. Use an empty string to delete the match.
    /// * `enabled` - Whether this rule is active.
    ///
    /// # Examples
    ///
    /// ```
    /// let rule = TitleReplacement::new(":", "_", true);
    /// assert_eq!(rule.from, ":");
    /// assert_eq!(rule.to, "_");
    /// assert!(rule.enabled);
    /// ```
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
    /// Directory path for downloaded videos.
    #[serde(rename = "dlOutputPath")]
    pub dl_output_path: Option<String>,
    /// Current application language.
    pub language: Language,
    /// Custom path for library dependencies (ffmpeg, etc.).
    ///
    /// Defaults to `app_data_dir()/lib/` if not specified. Allows users to
    /// store large dependencies on a different drive or location.
    #[serde(rename = "libPath")]
    pub lib_path: Option<String>,
    /// Whether the sidebar is expanded. Defaults to true.
    #[serde(rename = "sidebarExpanded")]
    pub sidebar_expanded: Option<bool>,
    /// Custom title replacement rules for filename sanitization.
    ///
    /// If not specified, backend uses default replacements.
    /// Maximum 20 rules allowed.
    #[serde(
        rename = "titleReplacements",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub title_replacements: Option<Vec<TitleReplacement>>,
    /// Whether to automatically rename duplicate part titles with
    /// index suffixes. Defaults to true.
    #[serde(
        rename = "autoRenameDuplicates",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub auto_rename_duplicates: Option<bool>,
    /// Whether to show GitHub stars in the app bar. Defaults to true.
    #[serde(
        rename = "showGithubStars",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub show_github_stars: Option<bool>,
    /// Whether to open devtools on app startup (development mode only).
    /// Defaults to true if not specified.
    #[serde(
        rename = "openDevtoolsOnStartup",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub open_devtools_on_startup: Option<bool>,
    /// Base font size in pixels (12-20). Applied as root font-size for rem-based scaling.
    /// Defaults to 16 (browser default) if not specified.
    #[serde(rename = "fontSize", default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u8>,
    /// Whether to skip the splash screen animation on startup.
    /// When true, a minimal loading indicator is shown instead of the 3D animation.
    #[serde(
        rename = "skipSplashAnimation",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub skip_splash_animation: Option<bool>,
}

/// Supported UI languages.
///
/// Each variant maps to a locale file in `src/i18n/locales/`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// English (default).
    #[default]
    En,
    /// Japanese.
    Ja,
    /// French.
    Fr,
    /// Spanish.
    Es,
    /// Simplified Chinese.
    Zh,
    /// Korean.
    Ko,
}
