fn main() {
    // Embed GA secrets if provided at build time
    if let Ok(secret) = std::env::var("GA_API_SECRET") {
        println!("cargo:rustc-env=GA_API_SECRET={secret}");
    }
    if let Ok(mid) = std::env::var("GA_MEASUREMENT_ID") {
        println!("cargo:rustc-env=GA_MEASUREMENT_ID={mid}");
    }
    tauri_build::build()
}
