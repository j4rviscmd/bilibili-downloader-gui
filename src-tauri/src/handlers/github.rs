//! GitHub API Handler
//!
//! Fetches repository information from GitHub API using octocrab.

use anyhow::Result;
use octocrab::Octocrab;

/// Fetches the star count for a GitHub repository.
///
/// Uses the GitHub API via octocrab to retrieve the stargazers count.
/// No authentication is required for public repositories.
///
/// # Arguments
///
/// * `owner` - Repository owner (e.g., "j4rviscmd")
/// * `repo` - Repository name (e.g., "bilibili-downloader-gui")
///
/// # Returns
///
/// Returns the star count as a `usize`.
///
/// # Errors
///
/// Returns an error if:
/// - The GitHub API request fails (network issues, rate limit exceeded)
/// - The repository is not found or private
/// - Invalid owner/repo parameters
///
/// # Example
///
/// Why: fetch_repo_stars queries the live GitHub API; doctests run in CI (rust-test
/// job) and must not hit external services
/// Note: the full-crate-path import is kept for documentation only — it is inert
/// inside an ignored block
/// ```ignore
/// use bilibili_downloader_gui_lib::handlers::github::fetch_repo_stars;
///
/// let stars = fetch_repo_stars("j4rviscmd", "bilibili-downloader-gui").await?;
/// println!("Stars: {}", stars);
/// ```
pub async fn fetch_repo_stars(owner: &str, repo: &str) -> Result<usize> {
    log::info!(
        "[BE] fetch_repo_stars: requesting stars for {}/{}",
        owner,
        repo
    );
    let github = Octocrab::builder().build()?;
    let repository = github
        .repos(owner, repo)
        .get()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch repository: {}", e))?;

    let stars = repository.stargazers_count.unwrap_or(0) as usize;
    log::info!(
        "[BE] fetch_repo_stars: received {} stars for {}/{}",
        stars,
        owner,
        repo
    );
    Ok(stars)
}
