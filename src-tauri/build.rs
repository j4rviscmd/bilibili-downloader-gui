fn main() {
    // 開発ビルド時はルート .env を優先読み込みし GA 関連値を埋め込む
    // .env フォーマット: KEY=VALUE (空行/ # コメント行は無視)
    #[cfg(debug_assertions)]
    {
        let mut loaded: Option<&str> = None;
        for candidate in ["../.env", ".env"] {
            if let Ok(env_content) = std::fs::read_to_string(candidate) {
                loaded = Some(candidate);
                for line in env_content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = trimmed.split_once('=') {
                        let key_u = key.trim();
                        let val_u = val.trim();
                        match key_u {
                            "GA_MEASUREMENT_ID" => println!("cargo:rustc-env=GA_MEASUREMENT_ID={val_u}"),
                            "GA_API_SECRET" => println!("cargo:rustc-env=GA_API_SECRET={val_u}"),
                            "GA_DEBUG" => println!("cargo:rustc-env=GA_DEBUG={val_u}"),
                            _ => {}
                        }
                    }
                }
                break;
            }
        }
        match loaded {
            Some(path) => println!("cargo:warning=Loaded GA .env from {path} (development only)"),
            None => println!("cargo:warning=No .env found at repo root or src-tauri (.env); GA secrets not embedded"),
        }
    }

    // CI / 本番など環境変数で直接渡された値があれば (開発でも .env が与えないキーを補完)
    if let Ok(secret) = std::env::var("GA_API_SECRET") {
        println!("cargo:rustc-env=GA_API_SECRET={secret}");
    }
    if let Ok(mid) = std::env::var("GA_MEASUREMENT_ID") {
        println!("cargo:rustc-env=GA_MEASUREMENT_ID={mid}");
    }
    if let Ok(debug) = std::env::var("GA_DEBUG") {
        println!("cargo:rustc-env=GA_DEBUG={debug}");
    }

    tauri_build::build()
}
