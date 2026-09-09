//! Error Handler Utilities
//!
//! This module provides panic and error handling utilities for logging
//! unexpected errors before the application terminates.

use std::panic;

/// Extracts a human-readable message from a panic payload.
///
/// Pure seam split out of the panic hook so payload handling is testable
/// without triggering a real panic through the global hook.
fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown panic payload".to_string()
    }
}

/// Sets up a custom panic hook that logs panic information.
///
/// This hook captures panic information (location and message) and
/// logs it using the `log` crate before the application terminates.
/// This ensures that unexpected panics are recorded in the log file.
///
/// # Example
///
/// Why: doctests compile as separate crates, so `crate::` paths do not resolve — use
/// the lib crate name instead (this PR's doctest policy)
/// ```rust,no_run
/// bilibili_downloader_gui_lib::utils::error_handler::setup_panic_hook();
/// ```
pub fn setup_panic_hook() {
    panic::set_hook(Box::new(|panic_info| {
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        log::error!(
            "[BE] APPLICATION PANIC at {}: {}",
            location,
            payload_message(panic_info.payload())
        );
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs `f` with panic output silenced and returns the caught payload.
    // Note: the panic hook is process-global while cargo test runs tests in
    // parallel threads of one process, so restoring the saved hook is
    // load-bearing — a test that leaves the silencer installed would swallow
    // panic reporting for every other test (std::panic::set_hook).
    fn catch_payload<F: FnOnce() + std::panic::UnwindSafe>(f: F) -> Box<dyn std::any::Any + Send> {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let payload = std::panic::catch_unwind(f).unwrap_err();
        std::panic::set_hook(previous);
        payload
    }

    #[test]
    fn setup_panic_hook_installs_without_panicking() {
        // Installs the hook; capturing the previous hook keeps the default
        // replaceable. The hook body itself is exercised by std's test
        // harness (any later panic logs via log::error).
        let previous = std::panic::take_hook();
        setup_panic_hook();
        std::panic::set_hook(previous);
    }

    #[test]
    fn payload_message_extracts_str_payload() {
        // catch_unwind preserves the panic!(&str) payload boxed; downcast
        // inside payload_message must recover the literal message.
        let payload = catch_payload(|| panic!("boom-str"));
        assert_eq!(payload_message(payload.as_ref()), "boom-str");
    }

    #[test]
    fn payload_message_extracts_string_payload() {
        let msg = String::from("boom-string");
        let payload = catch_payload(|| panic!("{}", msg));
        assert_eq!(payload_message(payload.as_ref()), "boom-string");
    }

    #[test]
    fn payload_message_falls_back_for_non_string_payload() {
        // panic_any with a non-string type exercises the fallback branch,
        // which normal `panic!` cannot reach.
        let payload = catch_payload(|| std::panic::panic_any(42usize));
        assert_eq!(payload_message(payload.as_ref()), "Unknown panic payload");
    }
}
