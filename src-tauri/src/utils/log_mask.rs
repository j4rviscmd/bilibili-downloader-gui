//! Log Masking Utility
//!
//! Provides functionality to mask sensitive information (cookies, tokens, etc.)
//! from log messages to prevent accidental leakage of credentials.

/// Masks sensitive information in log messages.
///
/// This function scans the input message for patterns that may contain sensitive
/// information and replaces them with asterisks. Currently masks:
/// - Cookie values (SESSDATA, bili_jct, DedeUserID)
/// - Token values (access_token, refresh_token)
///
/// # Arguments
///
/// * `message` - The log message that may contain sensitive information
///
/// # Returns
///
/// Returns a new string with sensitive values replaced by "***".
///
/// # Example
///
/// ```
/// use crate::utils::log_mask::mask_sensitive_info;
///
/// let message = "Request with SESSDATA=abc123def456 and bili_jct=xyz789";
/// let masked = mask_sensitive_info(message);
/// // masked: "Request with SESSDATA=*** and bili_jct=***"
/// ```
pub fn mask_sensitive_info(message: &str) -> String {
    let mut result = message.to_string();

    // Cookie patterns to mask: (pattern_name, minimum_length_to_mask)
    // The keep_len parameter is currently not used - we fully mask all values
    let cookie_patterns = [("SESSDATA=", 20), ("bili_jct=", 32), ("DedeUserID=", 10)];

    for (pattern, _keep_len) in cookie_patterns {
        result = mask_pattern_value(&result, pattern);
    }

    // Token patterns to mask
    let token_patterns = ["access_token=", "refresh_token="];
    for pattern in token_patterns {
        result = mask_pattern_value(&result, pattern);
    }

    result
}

/// Masks values following a specific pattern in the message.
///
/// This helper function finds occurrences of a pattern (e.g., "SESSDATA=")
/// and replaces the following value with "***". The value is considered
/// to end at the next whitespace, semicolon, comma, quote, or closing brace.
///
/// # Arguments
///
/// * `message` - The message to process
/// * `pattern` - The pattern that precedes the sensitive value
///
/// # Returns
///
/// Returns a new string with masked values.
fn mask_pattern_value(message: &str, pattern: &str) -> String {
    let mut result = String::new();
    let mut remaining = message;

    // Process all occurrences of the pattern
    while let Some(start) = remaining.find(pattern) {
        // Append everything up to and including the pattern
        result.push_str(&remaining[..=start + pattern.len() - 1]);

        // Move past the pattern
        let value_start = start + pattern.len();

        // Find the end of the value
        let value_end = remaining[value_start..]
            .find(&[' ', ';', ',', '"', '}'][..])
            .map(|pos| value_start + pos)
            .unwrap_or(remaining.len());

        // Append masked value
        result.push_str("***");

        // Move past the value
        remaining = &remaining[value_end..];
    }

    // Append any remaining text
    result.push_str(remaining);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_sessdata() {
        let message = "Cookie: SESSDATA=abc123def456 valid";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "Cookie: SESSDATA=*** valid");
    }

    #[test]
    fn test_mask_bili_jct() {
        let message = "bili_jct=xyz789abc123";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "bili_jct=***");
    }

    #[test]
    fn test_mask_dedeuserid() {
        let message = "DedeUserID=123456789";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "DedeUserID=***");
    }

    #[test]
    fn test_mask_access_token() {
        let message = "access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "access_token=***");
    }

    #[test]
    fn test_mask_refresh_token() {
        let message = "refresh_token=refresh123value";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "refresh_token=***");
    }

    #[test]
    fn test_mask_multiple_values() {
        let message = "SESSDATA=abc123, bili_jct=xyz789";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "SESSDATA=***, bili_jct=***");
    }

    #[test]
    fn test_mask_with_json_format() {
        let message = r#"{"cookie": "SESSDATA=abc123", "token": "bili_jct=xyz789"}"#;
        let masked = mask_sensitive_info(message);
        assert_eq!(
            masked,
            r#"{"cookie": "SESSDATA=***", "token": "bili_jct=***"}"#
        );
    }

    #[test]
    fn test_no_sensitive_info() {
        let message = "This is a regular log message without any sensitive data";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, message);
    }

    #[test]
    fn test_mask_with_url_encoded_values() {
        let message = "SESSDATA=abc%20def%20123";
        let masked = mask_sensitive_info(message);
        assert_eq!(masked, "SESSDATA=***");
    }
}
