//! Error Handler Utilities
//!
//! This module provides panic and error handling utilities for logging
//! unexpected errors before the application terminates.

use std::panic;

/// Sets up a custom panic hook that logs panic information.
///
/// This hook captures panic information (location and message) and
/// logs it using the `log` crate before the application terminates.
/// This ensures that unexpected panics are recorded in the log file.
///
/// # Example
///
/// ```rust,no_run
/// crate::utils::error_handler::setup_panic_hook();
/// ```
pub fn setup_panic_hook() {
    panic::set_hook(Box::new(|panic_info| {
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic payload".to_string()
        };

        log::error!("[BE] APPLICATION PANIC at {}: {}", location, message);
    }));
}
