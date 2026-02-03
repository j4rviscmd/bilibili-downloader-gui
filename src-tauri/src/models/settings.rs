//! Application Settings Model
//!
//! This module defines the settings structure persisted to settings.json
//! and the supported configuration options.

use serde::{Deserialize, Serialize};

/// Application settings structure.
///
/// Stores user preferences including download location and UI language.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub struct Settings {
    #[serde(rename = "dlOutputPath")]
    pub dl_output_path: Option<String>,
    pub language: Language,
    /// Custom path for library dependencies (ffmpeg, etc.).
    ///
    /// If not specified, defaults to `app_data_dir()/lib/`.
    /// This allows users to store large dependencies like ffmpeg on
    /// a different drive or location with more storage space.
    #[serde(rename = "libPath")]
    pub lib_path: Option<String>,
    //
    // TODO: 現状は利用していない
    // pub theme: Theme,
}

/// Supported UI languages.
///
/// Determines the language used for the application interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    /// English
    En,
    /// Japanese
    Ja,
    /// French
    Fr,
    /// Spanish
    Es,
    /// Chinese
    Zh,
    /// Korean
    Ko,
}

impl Default for Language {
    /// Returns English as the default language.
    fn default() -> Self {
        Language::En
    }
}

/// UI theme preference.
///
/// Currently unused, but reserved for future theme support.
#[derive(Default)]
pub enum Theme {
    /// Light theme
    Light,
    /// Dark theme (default)
    #[default]
    Dark,
}
