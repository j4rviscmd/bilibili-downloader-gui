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

    let current_version = Version::parse(current_version_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse current version: {}", e))?;

    let github = Octocrab::builder().build()?;
    const PER_PAGE: u32 = 30;
    let mut releases = Vec::new();

    for page in 1.. {
        let page_releases = github
            .repos(owner, repo)
            .releases()
            .list()
            .per_page(PER_PAGE)
            .page(page)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch releases page {page}: {e}"))?;

        if page_releases.items.is_empty() {
            break;
        }

        for release in page_releases.items {
            let version_str = release
                .tag_name
                .strip_prefix('v')
                .unwrap_or(&release.tag_name);

            if let Ok(version) = Version::parse(version_str) {
                if version > current_version {
                    releases.push(release);
                }
            }
        }

        if page_releases.items.len() < PER_PAGE as usize {
            break;
        }
    }

    if releases.is_empty() {
        return Ok("No new releases available".to_string());
    }

    // Sort releases by version (newest first)
    releases.sort_by(|a, b| {
        let parse_ver = |r: &octocrab::models::repos::Release| {
            Version::parse(r.tag_name.strip_prefix('v').unwrap_or(&r.tag_name)).ok()
        };
        match (parse_ver(b), parse_ver(a)) {
            (Some(vb), Some(va)) => vb.cmp(&va),
            _ => std::cmp::Ordering::Equal,
        }
    });

    // Generate release notes for each version
    let mut notes = String::new();
    const DEFAULT_BODY: &str = "See the assets to download this version and install.";

    for release in releases {
        if let Some(body) = &release.body {
            if !body.is_empty() && body != DEFAULT_BODY {
                notes.push_str(&format!("## {}\n\n{}\n\n---\n\n", release.tag_name, body));
            }
        }
    }

    notes.push_str(&format!(
        "*View [latest release](https://github.com/{}/{}/releases/latest) on GitHub*\n",
        owner, repo
    ));

    Ok(notes)
}
