//! Log redaction for user-identifying filesystem paths.
//!
//! Every log line rendered by the `tauri-plugin-log` targets (file and
//! stderr) passes through [`home_redaction_formatter`], so the OS account
//! name embedded in home-relative paths never reaches `app.log`.

// Why: support workflows ask users to attach app.log to issue reports,
// and every home-relative path embeds the PC account name (issue #941).
use tauri_plugin_log::fern::FormatCallback;

/// Replaces every occurrence of `home` that forms a real path with `~`.
///
/// An occurrence counts as a real path only when it is followed by a path
/// separator, a quote, whitespace, a closing bracket/comma, or the end of
/// the message — otherwise it is part of a longer name (`/home/alice` vs
/// `/home/alice2`) and must stay untouched.
pub fn redact_home_dir(message: &str, home: &str) -> String {
    if home.is_empty() {
        return message.to_string();
    }
    let mut result = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(pos) = rest.find(home) {
        let after = &rest[pos + home.len()..];
        let boundary = after
            .chars()
            .next()
            .is_none_or(|c| matches!(c, '/' | '\\' | '"' | '\'' | ',' | ')') || c.is_whitespace());
        result.push_str(&rest[..pos]);
        if boundary {
            result.push('~');
        } else {
            result.push_str(home);
        }
        rest = after;
    }
    result.push_str(rest);
    result
}

/// Builds a `tauri-plugin-log` formatter that redacts `home` from each log
/// line. Applied on `Builder::format`, it replaces the plugin default
/// renderer, so it must reproduce its line shape
/// (`[timestamp][LEVEL][target] message`, local time).
pub fn home_redaction_formatter(
    home: String,
) -> impl Fn(FormatCallback, &std::fmt::Arguments<'_>, &log::Record<'_>) + Send + Sync + 'static {
    move |out, message, record| {
        let redacted = redact_home_dir(&format!("{message}"), &home);
        // Note: a custom format takes over the timestamp entirely —
        // Builder::timezone_strategy then only dates rotated file names,
        // not log lines (tauri-plugin-log 2.6).
        let timestamp = chrono::Local::now().format("[%Y-%m-%d][%H:%M:%S]");
        out.finish(format_args!(
            "{timestamp}[{}][{}] {redacted}",
            record.level(),
            record.target()
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::{home_redaction_formatter, redact_home_dir};
    use std::sync::{Arc, Mutex};

    const HOME: &str = "/Users/alice";

    struct MemoryWriter(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for MemoryWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn replaces_path_under_home() {
        assert_eq!(
            redact_home_dir("output=/Users/alice/Downloads/x.mp4", HOME),
            "output=~/Downloads/x.mp4"
        );
    }

    #[test]
    fn replaces_multiple_occurrences() {
        let msg = r#"output="/Users/alice/Downloads/x.mp4", audio="/Users/alice/Library/temp.m4s""#;
        assert_eq!(
            redact_home_dir(msg, HOME),
            r#"output="~/Downloads/x.mp4", audio="~/Library/temp.m4s""#
        );
    }

    #[test]
    fn replaces_bare_home() {
        assert_eq!(
            redact_home_dir("resolved /Users/alice via ini", HOME),
            "resolved ~ via ini"
        );
        assert_eq!(redact_home_dir(r#""/Users/alice""#, HOME), r#""~""#);
    }

    #[test]
    fn leaves_similar_prefixes_untouched() {
        assert_eq!(redact_home_dir("/Users/alice2/x", HOME), "/Users/alice2/x");
        assert_eq!(redact_home_dir("/Users/alicefoo", HOME), "/Users/alicefoo");
    }

    #[test]
    fn windows_style_paths() {
        assert_eq!(
            redact_home_dir(r"C:\Users\alice\Downloads\x.mp4", r"C:\Users\alice"),
            "~\\Downloads\\x.mp4"
        );
    }

    #[test]
    fn message_without_home_is_unchanged() {
        assert_eq!(redact_home_dir("no path here", HOME), "no path here");
    }

    #[test]
    fn empty_home_is_noop() {
        assert_eq!(redact_home_dir("/Users/alice/x", ""), "/Users/alice/x");
    }

    #[test]
    fn home_redaction_formatter_renders_documented_line_shape() {
        let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
        let (_, logger) = tauri_plugin_log::fern::Dispatch::new()
            .format(home_redaction_formatter(HOME.to_string()))
            .chain(Box::new(MemoryWriter(buf.clone())) as Box<dyn std::io::Write + Send>)
            .into_log();
        let before = chrono::Local::now()
            .format("%Y-%m-%d][%H:%M:%S")
            .to_string();
        logger.log(
            &log::Record::builder()
                .level(log::Level::Info)
                .target("app::test")
                .args(format_args!("output=/Users/alice/Downloads/x.mp4"))
                .build(),
        );
        let after = chrono::Local::now()
            .format("%Y-%m-%d][%H:%M:%S")
            .to_string();
        let line = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        let rest = line.strip_prefix('[').unwrap();
        let (date, rest) = rest.split_once("][").unwrap();
        let (time, rest) = rest.split_once("][").unwrap();
        let (level, rest) = rest.split_once("][").unwrap();
        let (target, msg) = rest.split_once("] ").unwrap();
        let stamp = format!("{date}][{time}");
        assert!(stamp >= before && stamp <= after);
        assert_eq!(level, "INFO");
        assert_eq!(target, "app::test");
        assert_eq!(msg.trim_end_matches('\n'), "output=~/Downloads/x.mp4");
    }
}
