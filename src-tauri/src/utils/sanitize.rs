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
/// Why: doctests compile as separate crates, so bare/unqualified item names do not
/// resolve — import via the lib crate name (this PR's doctest policy)
/// ```
/// use bilibili_downloader_gui_lib::utils::sanitize::resolve_duplicate_titles;
///
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

/// Builds the default download filename for a part from the sanitized
/// video title and part name.
///
/// When `omit_duplicate` is true and the two sanitized strings match after
/// trimming surrounding whitespace, the part name is omitted so the
/// filename does not repeat the title (e.g., "My Song My Song"). Otherwise
/// the filename is `"{title} {part}"`.
///
/// Why trim comparison: bilibili sometimes returns part names that equal the
/// video title except for surrounding whitespace, which previously defeated
/// the frontend's strict-equality check.
///
/// # Arguments
///
/// * `sanitized_title` - Sanitized video title
/// * `sanitized_part` - Sanitized part name (after duplicate-title suffixing)
/// * `omit_duplicate` - Whether to omit a part name identical to the title
///
/// # Returns
///
/// The default download filename for the part.
///
/// # Examples
///
/// Why: doctests compile as separate crates, so bare/unqualified item names do not
/// resolve — import via the lib crate name (this PR's doctest policy)
/// ```
/// use bilibili_downloader_gui_lib::utils::sanitize::build_default_part_title;
///
/// assert_eq!(build_default_part_title("My Song", "My Song", true), "My Song");
/// assert_eq!(build_default_part_title("My Song", " My Song ", true), "My Song");
/// assert_eq!(build_default_part_title("My Song", "My Song", false), "My Song My Song");
/// assert_eq!(build_default_part_title("My Song", "Cover", true), "My Song Cover");
/// ```
pub fn build_default_part_title(
    sanitized_title: &str,
    sanitized_part: &str,
    omit_duplicate: bool,
) -> String {
    if omit_duplicate && sanitized_title.trim() == sanitized_part.trim() {
        sanitized_title.to_string()
    } else {
        format!("{} {}", sanitized_title, sanitized_part)
    }
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

    #[test]
    fn test_build_default_part_title_omits_matching_part() {
        // Identical sanitized strings -> title only
        assert_eq!(
            build_default_part_title("My Song", "My Song", true),
            "My Song"
        );
        // Surrounding whitespace is ignored
        assert_eq!(
            build_default_part_title("My Song", " My Song ", true),
            "My Song"
        );
    }

    #[test]
    fn test_build_default_part_title_combines_when_different() {
        assert_eq!(
            build_default_part_title("My Song", "Cover", true),
            "My Song Cover"
        );
        // Inner whitespace difference is NOT trimmed
        assert_eq!(
            build_default_part_title("My Song", "My  Song", true),
            "My Song My  Song"
        );
    }

    #[test]
    fn test_build_default_part_title_setting_off_always_combines() {
        assert_eq!(
            build_default_part_title("My Song", "My Song", false),
            "My Song My Song"
        );
    }
}
