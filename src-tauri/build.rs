fn main() {
    // In dev builds, prefer root .env for GA-related values
    // .env format: KEY=VALUE (blank lines / # comment lines are ignored)
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
                            "GA_MEASUREMENT_ID" => {
                                println!("cargo:rustc-env=GA_MEASUREMENT_ID={val_u}")
                            }
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

    // Override with environment variables if set (CI/production, or keys missing from .env)
    if let Ok(secret) = std::env::var("GA_API_SECRET") {
        println!("cargo:rustc-env=GA_API_SECRET={secret}");
    }
    if let Ok(mid) = std::env::var("GA_MEASUREMENT_ID") {
        println!("cargo:rustc-env=GA_MEASUREMENT_ID={mid}");
    }
    if let Ok(debug) = std::env::var("GA_DEBUG") {
        println!("cargo:rustc-env=GA_DEBUG={debug}");
    }

    tauri_build::try_build(build_attributes()).unwrap()
}

// tauri-build embeds the Common-Controls v6 manifest only into the main
// binary (rustc-link-arg-bins). Test binaries therefore bind comctl32 5.82
// and abort at load time with STATUS_ENTRYPOINT_NOT_FOUND: the static
// TaskDialogIndirect import (via muda/rfd) does not exist in 5.82.
// Embed the same manifest into every artifact (bins, tests, examples) instead.
// Doctests are not covered (separate rustdoc link-arg mechanism).
// See https://github.com/tauri-apps/tauri/issues/13419
#[cfg(windows)]
fn build_attributes() -> tauri_build::Attributes {
    let manifest = std::env::var("CARGO_MANIFEST_DIR")
        .unwrap()
        .trim_end_matches(['\\', '/'])
        .to_string()
        + "\\windows-app-manifest.xml";
    println!("cargo:rerun-if-changed={manifest}");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}");
    tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
}

#[cfg(not(windows))]
fn build_attributes() -> tauri_build::Attributes {
    tauri_build::Attributes::new()
}
