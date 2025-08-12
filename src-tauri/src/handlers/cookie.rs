use std::{collections::HashMap, fs, path::PathBuf};

use rusqlite::{Connection, Result as SqlResult};
use tauri::AppHandle;
use tauri::Manager;

use crate::models::{CookieCache, CookieEntry};

pub fn read_cookie(app: &AppHandle) -> Result<Option<HashMap<String, String>>, String> {
    // キャッシュを参照する場合は、app.state::<CookieCache>().cookies.lock() から取出
    if let Some(cache) = app.try_state::<CookieCache>() {
        if let Ok(guard) = cache.cookies.lock() {
            let mut map = HashMap::new();
            for entry in guard.iter() {
                map.insert(entry.name.clone(), entry.value.clone());
            }
            return Ok(Some(map));
        }
    }
    Ok(None)
}

// Firefox の cookies.sqlite を探す（macOS 想定。必要なら他OS分岐を追加）
fn find_firefox_cookie_file(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = app.path().home_dir().unwrap();
        let profiles_root = home.join("Library/Application Support/Firefox/Profiles");
        if !profiles_root.exists() {
            return None;
        }
        // プロファイル配下を走査して最初に見つかった cookies.sqlite を返す
        if let Ok(entries) = fs::read_dir(&profiles_root) {
            for entry in entries.flatten() {
                let p = entry.path().join("cookies.sqlite");
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub async fn get_cookie(app: &AppHandle) -> Result<bool, String> {
    // 1) ローカルの Firefox cookie DB を探索
    let Some(cookiefile) = find_firefox_cookie_file(&app) else {
        return Ok(false);
    };

    // 2) 一時ディレクトリにコピー（Firefox 実行中ロック対策）
    let tmp_dir = std::env::temp_dir();
    let tmp_cookie = tmp_dir.join("temp_cookiefile.sqlite");
    fs::copy(&cookiefile, &tmp_cookie).map_err(|e| format!("failed to copy cookie db: {e}"))?;

    // 3) SQLite を開いて moz_cookies から host, name, value を読む（デバッグ表示）
    let mut cookies = HashMap::<String, String>::new();
    let read_res: SqlResult<bool> = (|| {
        let conn = Connection::open(&tmp_cookie)?;
        let mut stmt = conn.prepare("SELECT host, name, value FROM moz_cookies")?;
        let rows = stmt.query_map([], |row| {
            let host: String = row.get(0)?;
            let name: String = row.get(1)?;
            let value: String = row.get(2)?;
            Ok((host, name, value))
        })?;
        let mut count = 0usize;
        for row in rows {
            let (host, name, value) = row?;
            if host == ".bilibili.com" {
                cookies.insert(name, value);
                count += 1;
            }
        }
        println!("total cookies fetched: {count}");
        Ok(count > 0)
    })();

    match read_res {
        Ok(has_any) => {
            // for (name, value) in cookies.iter() {
            //     println!("cookie: name={}, value={}", name, value);
            // }

            // メモリキャッシュへ保存
            // NOTE: 次回の処理でキャッシュを参照する場合は、app.state::<CookieCache>().cookies.lock() から取出
            if let Some(cache) = app.try_state::<CookieCache>() {
                if let Ok(mut guard) = cache.cookies.lock() {
                    let mut vec = Vec::with_capacity(cookies.len());
                    for (name, value) in cookies.into_iter() {
                        vec.push(CookieEntry {
                            host: ".bilibili.com".to_string(),
                            name,
                            value,
                        });
                    }
                    *guard = vec;
                }
            }

            Ok(has_any)
        }
        Err(e) => Err(format!("sqlite read error: {e}")),
    }
}
