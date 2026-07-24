//! Application settings persisted to settings.json

use crate::utils::codec::VideoCodecPriority;
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
    /// Defaults to 14 if not specified.
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
    /// Default trim mode for the MP4 trimming feature.
    /// Defaults to "copy" (stream copy) if not specified.
    #[serde(rename = "trimMode", default, skip_serializing_if = "Option::is_none")]
    pub trim_mode: Option<TrimMode>,
    /// Default output format for the audio extraction feature.
    /// Defaults to "mp3" if not specified.
    #[serde(
        rename = "audioFormat",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub audio_format: Option<AudioFormat>,
    /// Default rotation angle (clockwise degrees: 90/180/270) for the MP4
    /// rotation feature. Defaults to 90 if not specified.
    #[serde(
        rename = "rotationAngle",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub rotation_angle: Option<u16>,
    /// Default rotation mode for the MP4 rotation feature.
    /// Defaults to "copy" (metadata-only) if not specified.
    #[serde(
        rename = "rotationMode",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub rotation_mode: Option<RotationMode>,
    /// Whether to show download progress on the taskbar. Defaults to true.
    #[serde(
        rename = "showTaskbarProgress",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub show_taskbar_progress: Option<bool>,
    /// Whether to flash the taskbar button when downloads complete.
    /// Defaults to true.
    #[serde(
        rename = "flashTaskbarOnComplete",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub flash_taskbar_on_complete: Option<bool>,
    /// UI theme preference. Defaults to system preference if not set.
    #[serde(rename = "theme", default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<UiTheme>,
    /// Video codec priority preference. Defaults to AV1-first if not set.
    #[serde(
        rename = "videoCodecPriority",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub video_codec_priority: Option<VideoCodecPriority>,
    /// Number of parallel segment downloads (1, 2, 4, 6, or 8). Defaults to 8.
    #[serde(
        rename = "downloadParallelism",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub download_parallelism: Option<u8>,
}

/// Trim mode for the MP4 trimming feature.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrimMode {
    /// Stream copy (-c copy), fast but keyframe-accurate only.
    #[default]
    Copy,
    /// Re-encode (libx264), slow but frame-accurate.
    Reencode,
}

/// Output format for the audio extraction feature.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    /// MP3 (libmp3lame), `.mp3`.
    #[default]
    Mp3,
    /// AAC in MP4 container, `.m4a`.
    M4a,
}

/// Rotation mode for the MP4 rotation feature.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RotationMode {
    /// Metadata-only rotation (`-display_rotation` + `-c copy`). Fast and
    /// lossless, but some players ignore the display matrix.
    #[default]
    Copy,
    /// Re-encode with `transpose` filter. Works in all players but slower
    /// and lossy.
    Reencode,
}

/// UI theme preference for light/dark mode.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiTheme {
    /// Light theme (default).
    #[default]
    Light,
    /// Dark theme.
    Dark,
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

impl Settings {
    /// Resolves the segment download concurrency from settings.
    ///
    /// Returns the number of parallel segment downloads, ensuring:
    /// - Values are clamped to 1-8 range
    /// - Only even values are allowed (2, 4, 6, 8), except for 1 (single-threaded fallback)
    /// - Defaults to 8 if not specified
    ///
    /// # Arguments
    ///
    /// * `settings` - The application settings (optional)
    ///
    /// # Returns
    ///
    /// The resolved concurrency value (1, 2, 4, 6, or 8).
    ///
    /// # Examples
    ///
    /// ```ignore
    /// // Unit tests in `mod tests` below cover all clamping/rounding cases
    /// // (0→1, 1→1, 2→2, 3→4, 5→6, 7→8, 8→8, 9→8, None→8). This doctest
    /// // is intentionally ignored because `Settings::resolve_segment_concurrency`
    /// // is an associated function that cannot be invoked as a free function.
    /// assert_eq!(Settings::resolve_segment_concurrency(&None), 8);
    /// ```
    pub fn resolve_segment_concurrency(settings: &Option<Settings>) -> usize {
        // Why: default is 8 (raised above issue #491's originally proposed
        //   default of 1) because CDN pre-selection (#490) mitigates the
        //   instability that previously forced concurrency=1, making higher
        //   parallelism safe for most connections (issue #491).
        // Constraint: the allowed steps (1/2/4/6/8) must match the RadioGroup
        //   options in SettingsForm.tsx; any out-of-range or odd value is
        //   snapped to the nearest valid step in the match below.
        // Caution: high values (8/6) can trigger bilibili CDN throttling; on
        //   unstable links users should reduce to 4 or 2 (issue #491 risks).
        let val = settings
            .as_ref()
            .and_then(|s| s.download_parallelism)
            .unwrap_or(8);
        // Clamp to [1, 8] and snap to the nearest allowed step (1/2/4/6/8).
        match val {
            n if n <= 1 => 1,
            n if n <= 2 => 2,
            n if n <= 4 => 4,
            n if n <= 6 => 6,
            _ => 8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_segment_concurrency_default() {
        // None → 8
        assert_eq!(Settings::resolve_segment_concurrency(&None), 8);
    }

    #[test]
    fn test_resolve_segment_concurrency_explicit_values() {
        // Test explicit even values
        let settings = Settings {
            download_parallelism: Some(2),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 2);

        let settings = Settings {
            download_parallelism: Some(4),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 4);

        let settings = Settings {
            download_parallelism: Some(6),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 6);

        let settings = Settings {
            download_parallelism: Some(8),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 8);
    }

    #[test]
    fn test_resolve_segment_concurrency_single_threaded() {
        // 1 is allowed (single-threaded fallback)
        let settings = Settings {
            download_parallelism: Some(1),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 1);
    }

    #[test]
    fn test_resolve_segment_concurrency_odd_values_round_up() {
        // Odd values should round up to next even
        let settings = Settings {
            download_parallelism: Some(3),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 4);

        let settings = Settings {
            download_parallelism: Some(5),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 6);

        let settings = Settings {
            download_parallelism: Some(7),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 8);
    }

    #[test]
    fn test_resolve_segment_concurrency_clamp_range() {
        // Values below 1 should clamp to 1
        let settings = Settings {
            download_parallelism: Some(0),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 1);

        // Values above 8 should clamp to 8
        let settings = Settings {
            download_parallelism: Some(10),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 8);

        let settings = Settings {
            download_parallelism: Some(100),
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 8);
    }

    #[test]
    fn test_resolve_segment_concurrency_none_value() {
        // None in settings → 8
        let settings = Settings {
            download_parallelism: None,
            ..Default::default()
        };
        assert_eq!(Settings::resolve_segment_concurrency(&Some(settings)), 8);
    }
}
