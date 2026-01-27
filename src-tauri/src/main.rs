//! Bilibili Downloader GUI Application Entry Point
//!
//! This is the main entry point for the Tauri-based desktop application.
//! It delegates application setup and execution to the library module.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Main entry point for the Bilibili Downloader GUI application.
///
/// This function initializes and runs the Tauri application by delegating to
/// the library's `run()` function.
fn main() {
    bilibili_downloader_gui_lib::run()
}
