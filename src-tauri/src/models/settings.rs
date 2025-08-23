use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub struct Settings {
    pub language: Language,
    //
    // TODO: 現状は利用していない
    // pub theme: Theme,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    Ja,
    Fr,
    Es,
    Zh,
    Ko,
}

/// ------------
/// デフォルト定義
/// ------------

impl Default for Language {
    fn default() -> Self {
        Language::En
    }
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}
