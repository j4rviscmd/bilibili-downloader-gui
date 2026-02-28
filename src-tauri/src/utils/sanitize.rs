//! Filename Sanitization Utilities
//!
//! This module provides functions to sanitize filenames by applying
//! user-configurable character replacement rules.

use crate::models::settings::{default_title_replacements, TitleReplacement};

/// Applies title replacement rules to sanitize a filename.
///
/// Iterates through the replacement rules and applies each enabled rule
/// in order. If no rules are provided, uses the default replacements.
///
/// # Arguments
///
/// * `filename` - The original filename to sanitize
/// * `replacements` - Optional slice of replacement rules to apply
///
/// # Returns
///
/// The sanitized filename with all enabled replacements applied.
///
/// # Examples
///
/// ```
/// use bilibili_downloader_gui::utils::sanitize::apply_title_replacements;
/// use bilibili_downloader_gui::models::settings::TitleReplacement;
///
/// let rules = vec![
///     TitleReplacement::new("/", "-", true),
///     TitleReplacement::new(":", "_", true),
/// ];
/// let result = apply_title_replacements("Video: Part 1/2", Some(&rules));
/// assert_eq!(result, "Video_ Part 1-2");
/// ```
pub fn apply_title_replacements(
    filename: &str,
    replacements: Option<&[TitleReplacement]>,
) -> String {
    let rules = replacements
        .map(|r| r.to_vec())
        .unwrap_or_else(default_title_replacements);

    let mut result = filename.to_string();

    for rule in rules.iter().filter(|r| r.enabled) {
        result = result.replace(&rule.from, &rule.to);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_replacements_with_defaults() {
        // Test default replacements
        let result = apply_title_replacements("Video: Part 1/2?", None);
        assert_eq!(result, "Video_ Part 1-2");

        let result = apply_title_replacements("File*Name\"Test", None);
        assert_eq!(result, "FilexName'Test");

        let result = apply_title_replacements("Show<Episode>|Test", None);
        assert_eq!(result, "Show(Episode)-Test");
    }

    #[test]
    fn test_apply_replacements_with_custom_rules() {
        let rules = vec![
            TitleReplacement::new(" ", "_", true),
            TitleReplacement::new(":", "-", true),
        ];
        let result = apply_title_replacements("Video: Test", Some(&rules));
        assert_eq!(result, "Video-_Test");
    }

    #[test]
    fn test_apply_replacements_disabled_rule() {
        let rules = vec![
            TitleReplacement::new("/", "-", false), // disabled
            TitleReplacement::new(":", "_", true),
        ];
        let result = apply_title_replacements("Video: Part 1/2", Some(&rules));
        // "/" should NOT be replaced because the rule is disabled
        assert_eq!(result, "Video_ Part 1/2");
    }

    #[test]
    fn test_apply_replacements_empty_to_value() {
        let rules = vec![TitleReplacement::new("?", "", true)];
        let result = apply_title_replacements("What?", Some(&rules));
        assert_eq!(result, "What");
    }

    #[test]
    fn test_apply_replacements_multi_char_from() {
        // Test replacing multi-character strings
        let rules = vec![TitleReplacement::new("[Official]", "", true)];
        let result = apply_title_replacements("Video [Official] HD", Some(&rules));
        assert_eq!(result, "Video  HD");
    }

    #[test]
    fn test_apply_replacements_preserves_original() {
        // Empty rules should not modify the string
        let rules: Vec<TitleReplacement> = vec![];
        let result = apply_title_replacements("Test: File", Some(&rules));
        assert_eq!(result, "Test: File");
    }
}
