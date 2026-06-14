//! FFmpeg Progress Parsing Utilities
//!
//! Shared parsers for ffmpeg's `-progress` output format. Used by both
//! trim and concat handlers to parse timestamps and progress lines.

/// Parses an `HH:MM:SS.fraction` timestamp into seconds.
pub fn parse_hhmmss(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// Parses an `out_time=HH:MM:SS.fraction` line from ffmpeg's `-progress`
/// output into seconds. Returns `None` for unrelated lines or malformed
/// timestamps.
pub fn parse_out_time(line: &str) -> Option<f64> {
    let s = line.strip_prefix("out_time=")?.trim();
    parse_hhmmss(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_out_time_seconds() {
        assert_eq!(parse_out_time("out_time=00:00:12.500000\n"), Some(12.5));
    }

    #[test]
    fn parse_out_time_with_hours() {
        assert_eq!(parse_out_time("out_time=01:02:03.000000\n"), Some(3723.0));
    }

    #[test]
    fn parse_out_time_ignores_other_keys() {
        assert_eq!(parse_out_time("frame=123\n"), None);
        assert_eq!(parse_out_time("out_time_ms=12345678\n"), None);
    }

    #[test]
    fn parse_hhmmss_with_fraction() {
        assert_eq!(parse_hhmmss("00:01:23.450000"), Some(83.45));
    }

    #[test]
    fn parse_hhmmss_rejects_short_input() {
        assert_eq!(parse_hhmmss("01:23"), None);
        assert_eq!(parse_hhmmss("not a time"), None);
    }
}
