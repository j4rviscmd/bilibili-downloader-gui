//! GitHub Release Notes Handler
//!
//! This module handles fetching release notes from GitHub API.
//! It uses the octocrab crate to interact with GitHub's REST API.

use anyhow::Result;
use octocrab::Octocrab;

/// Fetches all release notes from GitHub for versions newer than current.
///
/// This function retrieves all releases from the GitHub repository,
/// filters them to include only versions newer than the current version,
/// and merges their release notes into a single Markdown document.
///
/// # Arguments
///
/// * `owner` - Repository owner (e.g., "j4rviscmd")
/// * `repo` - Repository name (e.g., "bilibili-downloader-gui")
/// * `current_version_str` - Current application version (e.g., "1.1.0")
///
/// # Returns
///
/// Returns merged release notes as a Markdown-formatted string.
///
/// # Errors
///
/// Returns an error if:
/// - The GitHub API request fails
/// - The current version cannot be parsed as semver
///
/// # Example
///
/// ```rust
/// let notes = fetch_all_release_notes("j4rviscmd", "bilibili-downloader-gui", "1.1.0").await?;
/// assert!(notes.contains("## v1.1.1"));
/// ```
pub async fn fetch_all_release_notes(
    owner: &str,
    repo: &str,
    current_version_str: &str,
) -> Result<String> {
    use semver::Version;

    // Parse current version
    let current_version = Version::parse(current_version_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse current version: {}", e))?;

    // Create GitHub client (no authentication needed for public repos)
    let github = Octocrab::builder().build()?;

    // Fetch all releases
    let mut all_releases: Vec<octocrab::models::repos::Release> = Vec::new();
    let mut page = 1u32;
    let per_page = 30;

    loop {
        let repo_handler = github.repos(owner, repo);
        let releases = repo_handler.releases().list().per_page(per_page).page(page).send().await
            .map_err(|e| anyhow::anyhow!("Failed to fetch releases page {}: {}", page, e))?;

        let releases_len = releases.items.len();

        for release in releases.items {
            // Parse version from tag_name (remove 'v' prefix if present)
            let version_str = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);

            if let Ok(version) = Version::parse(version_str) {
                // Only include releases newer than current version
                if version > current_version {
                    all_releases.push(release.clone());
                }
            }
        }

        if releases_len < per_page as usize {
            break;
        }

        page += 1;
    }

    if all_releases.is_empty() {
        return Ok("No new releases available".to_string());
    }

    // Sort releases by version (newest first)
    all_releases.sort_by(|a, b| {
        let ver_a = Version::parse(a.tag_name.strip_prefix('v').unwrap_or(&a.tag_name));
        let ver_b = Version::parse(b.tag_name.strip_prefix('v').unwrap_or(&b.tag_name));
        ver_b.unwrap().cmp(&ver_a.unwrap())
    });

    // Generate release notes for each version
    let mut all_notes = String::new();

    for release in all_releases {
        let tag_name = &release.tag_name;

        if let Some(body) = &release.body {
            if !body.is_empty() && body != "See the assets to download this version and install." {
                all_notes.push_str(&format!("## {}\n\n", tag_name));
                all_notes.push_str(body);
                all_notes.push_str("\n\n---\n\n");
            }
        }
    }

    // Add footer link
    all_notes.push_str(&format!(
        "*View [latest release](https://github.com/{}/{}/releases/latest) on GitHub*\n",
        owner, repo
    ));

    Ok(all_notes)
}
