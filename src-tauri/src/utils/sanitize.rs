//! Filename Sanitization Utilities
//!
//! This module provides functions to sanitize filenames by applying
//! user-configurable character replacement rules.

use crate::models::settings::{default_title_replacements, TitleReplacement};
use std::collections::HashMap;

/// Applies title replacement rules to sanitize a filename.
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

/// Resolves duplicate titles by adding index suffixes (e.g., "hoge" -> "hoge (1)").
///
/// Processes a list of titles and adds numerical suffixes to duplicate entries
/// to ensure uniqueness. The first occurrence of each title remains unchanged,
/// the second occurrence gets "(1)", the third gets "(2)", and so on.
///
/// # Arguments
///
/// * `titles` - A slice of title strings to deduplicate
///
/// # Returns
///
/// A new `Vec<String>` with duplicate titles resolved by adding index suffixes.
///
/// # Examples
///
/// ```
/// let titles = vec![
///     "Part 1".to_string(),
///     "Part 2".to_string(),
///     "Part 1".to_string(),
///     "Part 1".to_string(),
/// ];
/// let resolved = resolve_duplicate_titles(&titles);
/// assert_eq!(resolved, vec!["Part 1", "Part 2", "Part 1 (1)", "Part 1 (2)"]);
/// ```
pub fn resolve_duplicate_titles(titles: &[String]) -> Vec<String> {
    let mut seen: HashMap<&str, usize> = HashMap::new();

    titles
        .iter()
        .map(|title| {
            let count = seen.entry(title.as_str()).or_insert(0);
            *count += 1;

            if *count == 1 {
                title.clone()
            } else {
                format!("{} ({})", title, *count - 1)
            }
        })
        .collect()
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

    #[test]
    fn test_resolve_duplicate_titles_all_duplicates() {
        let titles = vec!["hoge".to_string(), "hoge".to_string(), "hoge".to_string()];
        let result = resolve_duplicate_titles(&titles);
        assert_eq!(
            result,
            vec![
                "hoge".to_string(),
                "hoge (1)".to_string(),
                "hoge (2)".to_string()
            ]
        );
    }

    #[test]
    fn test_resolve_duplicate_titles_no_duplicates() {
        let titles = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let result = resolve_duplicate_titles(&titles);
        assert_eq!(
            result,
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn test_resolve_duplicate_titles_mixed() {
        let titles = vec!["a".to_string(), "b".to_string(), "a".to_string()];
        let result = resolve_duplicate_titles(&titles);
        assert_eq!(
            result,
            vec!["a".to_string(), "b".to_string(), "a (1)".to_string()]
        );
    }

    #[test]
    fn test_resolve_duplicate_titles_empty() {
        let titles: Vec<String> = vec![];
        let result = resolve_duplicate_titles(&titles);
        assert!(result.is_empty());
    }

    #[test]
    fn test_resolve_duplicate_titles_single() {
        let titles = vec!["single".to_string()];
        let result = resolve_duplicate_titles(&titles);
        assert_eq!(result, vec!["single".to_string()]);
    }
}
