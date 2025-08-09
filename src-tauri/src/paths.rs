use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// ffmpegバイナリのパスを取得
pub fn get_ffmpeg_path(app: &AppHandle) -> PathBuf {
    let lib = get_lib_path(app);
    let ffmpeg = if cfg!(target_os = "windows") {
        let mut ffmpeg = lib
            .join("ffmpeg-master-latest-win64-lgpl-shared")
            .join("bin")
            .join("ffmpeg")
            .clone();
        ffmpeg.set_extension("exe");
        ffmpeg.clone()
    } else {
        lib.join("ffmpeg").join("ffmpeg").clone()
    };
    println!("FFmpeg path: {:?}", ffmpeg);

    ffmpeg
}

pub fn get_ffmpeg_root_path(app: &AppHandle) -> PathBuf {
    let lib = get_lib_path(app);
    if cfg!(target_os = "windows") {
        lib.join("ffmpeg-master-latest-win64-lgpl-shared")
    } else {
        lib.join("ffmpeg")
    }
}

// /// その他のバイナリやライブラリのパスも同様に追加可能
// pub fn get_lib_path(app: &AppHandle, name: &str) -> PathBuf {
//     app.path_resolver()
//         .resolve_resource(&format!("lib/{}", name))
//         .expect("failed to resolve lib path")
// }

fn get_lib_path(app: &AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap().join("lib")
}
