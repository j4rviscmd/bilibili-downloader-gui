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
    fetch_repo_stars_with(&github, owner, repo).await
}

/// Transport-injectable variant of [`fetch_repo_stars`] (test seam: wiremock
/// tests pass a client whose base URL points at a local server).
async fn fetch_repo_stars_with(github: &Octocrab, owner: &str, repo: &str) -> Result<usize> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn mock_client(base: &str) -> Octocrab {
        Octocrab::builder().base_uri(base).unwrap().build().unwrap()
    }

    #[tokio::test]
    async fn returns_stargazers_count_on_success() {
        let server = MockServer::start().await;
        // Why: this fixture cannot shrink to just stargazers_count — octocrab's
        // Repository model requires `id`/`name`/`url`, and every URL-typed field
        // (`url`, `html_url`, and all `owner.*` URLs once `owner` is present) is
        // `url::Url` and only parses absolute URLs, so a minimal or relative-URL
        // body fails deserialization before the count is read
        // (octocrab 0.42 src/models.rs, Repository/Author fields).
        Mock::given(method("GET"))
            .and(path("/repos/j4rviscmd/bilibili-downloader-gui"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 123456,
                "name": "bilibili-downloader-gui",
                "full_name": "j4rviscmd/bilibili-downloader-gui",
                "private": false,
                "stargazers_count": 42,
                "html_url": "https://github.com/j4rviscmd/bilibili-downloader-gui",
                "description": "desc",
                "fork": false,
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
                "pushed_at": "2024-01-01T00:00:00Z",
                "size": 1000,
                "url": "https://api.github.com/repos/j4rviscmd/bilibili-downloader-gui",
                "node_id": "R_123",
                "owner": {"login": "j4rviscmd", "id": 1, "node_id": "U_1", "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4", "gravatar_id": "", "url": "https://api.github.com/users/j4rviscmd", "received_events_url": "https://api.github.com/users/j4rviscmd/received_events", "type": "User", "html_url": "https://github.com/j4rviscmd", "followers_url": "https://api.github.com/users/j4rviscmd/followers", "following_url": "https://api.github.com/users/j4rviscmd/following{/other_user}", "gists_url": "https://api.github.com/users/j4rviscmd/gists{/gist_id}", "organizations_url": "https://api.github.com/users/j4rviscmd/orgs", "repos_url": "https://api.github.com/users/j4rviscmd/repos", "starred_url": "https://api.github.com/users/j4rviscmd/starred{/owner}{/repo}", "subscriptions_url": "https://api.github.com/users/j4rviscmd/subscriptions", "events_url": "https://api.github.com/users/j4rviscmd/events{/privacy}", "site_admin": false}
            })))
            .mount(&server)
            .await;

        let stars = fetch_repo_stars_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
        )
        .await
        .unwrap();
        assert_eq!(stars, 42);
    }

    #[tokio::test]
    async fn missing_stargazers_count_counts_as_zero() {
        let server = MockServer::start().await;
        // Repository JSON without stargazers_count (serde default -> None)
        Mock::given(method("GET"))
            .and(path("/repos/o/r"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 1,
                "name": "r",
                "full_name": "o/r",
                "private": false,
                "url": "https://api.github.com/repos/o/r",
                "node_id": "R_1",
                "forks_count": 0,
                "watchers_count": 0,
                "open_issues_count": 0,
                "default_branch": "main"
            })))
            .mount(&server)
            .await;

        let stars = fetch_repo_stars_with(&mock_client(&server.uri()), "o", "r")
            .await
            .unwrap();
        assert_eq!(stars, 0);
    }

    #[tokio::test]
    async fn api_error_is_wrapped_with_context() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/o/missing"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let err = fetch_repo_stars_with(&mock_client(&server.uri()), "o", "missing")
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("Failed to fetch repository"),
            "error should carry request-failure context, got: {err}"
        );
    }
}
