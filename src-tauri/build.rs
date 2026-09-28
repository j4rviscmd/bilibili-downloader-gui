fn main() {
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
