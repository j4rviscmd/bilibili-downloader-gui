use std::sync::Mutex;

use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CookieEntry {
    pub host: String,
    pub name: String,
    pub value: String,
}

#[derive(Default)]
pub struct CookieCache {
    pub cookies: Mutex<Vec<CookieEntry>>,
}
