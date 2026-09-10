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
/// Why: fetch_all_release_notes paginates the live GitHub API; doctests run in CI
/// (rust-test job) and must not hit external services
/// ```ignore
/// let notes = fetch_all_release_notes("j4rviscmd", "bilibili-downloader-gui", "1.1.0").await?;
/// assert!(notes.contains("## v1.1.1"));
/// ```
pub async fn fetch_all_release_notes(
    owner: &str,
    repo: &str,
    current_version_str: &str,
) -> Result<String> {
    log::info!(
        "[BE] fetch_all_release_notes: owner={}, repo={}, current_version={}",
        owner,
        repo,
        current_version_str
    );
    let github = Octocrab::builder().build()?;
    fetch_all_release_notes_with(&github, owner, repo, current_version_str).await
}

/// Transport-injected split of [`fetch_all_release_notes`] (test seam, issue
/// #646): rides the given octocrab client, so wiremock tests substitute the
/// GitHub origin (same pattern as `fetch_repo_stars_with` in handlers/github.rs).
async fn fetch_all_release_notes_with(
    github: &Octocrab,
    owner: &str,
    repo: &str,
    current_version_str: &str,
) -> Result<String> {
    use semver::Version;

    let current_version = Version::parse(current_version_str)
        .map_err(|e| anyhow::anyhow!("Failed to parse current version: {}", e))?;

    const PER_PAGE: u8 = 30;
    let mut releases = Vec::new();

    for page in 1u32.. {
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

        let mut any_newer = false;
        for release in &page_releases.items {
            let version_str = release
                .tag_name
                .strip_prefix('v')
                .unwrap_or(&release.tag_name);

            if let Ok(version) = Version::parse(version_str) {
                if version > current_version {
                    releases.push(release.clone());
                    any_newer = true;
                }
            }
        }

        // Why early-exit: GitHub returns releases newest-first, so once a
        // full page contains nothing newer than the current version, every
        // later page is older. Without this, a repo with hundreds of
        // releases paginates ~20 requests per check and exhausts the
        // unauthenticated 60 req/h rate limit (observed as "no release
        // notes" fallbacks).
        if !any_newer {
            break;
        }

        if page_releases.items.len() < PER_PAGE as usize {
            break;
        }
    }

    Ok(format_releases_markdown(
        releases,
        &format!("https://github.com/{}/{}/releases/latest", owner, repo),
        "latest release",
        "No new releases available",
    ))
}

/// Fetches all releases from GitHub as a Markdown document.
///
/// Unlike `fetch_all_release_notes`, this function returns all published
/// releases regardless of version, sorted newest-first.
pub async fn fetch_all_releases_markdown(owner: &str, repo: &str) -> Result<String> {
    log::info!(
        "[BE] fetch_all_releases_markdown: owner={}, repo={}",
        owner,
        repo
    );
    let github = Octocrab::builder().build()?;
    fetch_all_releases_markdown_with(&github, owner, repo).await
}

/// Transport-injected split of [`fetch_all_releases_markdown`] (test seam,
/// issue #646): rides the given octocrab client.
async fn fetch_all_releases_markdown_with(
    github: &Octocrab,
    owner: &str,
    repo: &str,
) -> Result<String> {
    const PER_PAGE: u8 = 30;
    let mut releases = Vec::new();

    for page in 1u32.. {
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

        releases.extend(page_releases.items);

        if releases.len() >= PER_PAGE as usize {
            break;
        }
    }

    Ok(format_releases_markdown(
        releases,
        &format!("https://github.com/{}/{}/releases", owner, repo),
        "all releases",
        "No releases found.",
    ))
}

// Why: issue #560 requires a single updater path per machine — with parallel
// download instances, two sessions racing the check->download window would
// double-install or downgrade each other; this flock is that serialization point.
/// Opens `update.lock` and claims its exclusive flock (test seam, issue
/// #646): split out of lib.rs's `begin_update_session` (lib.rs is excluded
/// from coverage measurement) so the open/lock/error-mapping logic is both
/// measurable and runnable against an explicit tempdir path. The caller
/// keeps the returned file alive — dropping it releases the flock.
pub(crate) fn try_acquire_update_lock(
    lock_path: &std::path::Path,
) -> Result<std::fs::File, String> {
    use fs2::FileExt;

    let file = std::fs::OpenOptions::new()
        .create(true)
        // truncate(false): re-opening an existing update.lock must not zero it.
        .truncate(false)
        .write(true)
        .read(true)
        .open(lock_path)
        .map_err(|e| format!("Failed to open update.lock: {}", e))?;

    // Non-blocking: another live instance holds it right now.
    file.try_lock_exclusive()
        .map_err(|_| "ERR::UPDATE_IN_PROGRESS".to_string())?;

    Ok(file)
}

/// Pure Markdown assembly shared by both fetchers: sort releases
/// newest-first by `v`-stripped semver tag and render note bodies.
///
/// Releases whose body is missing, empty, or the auto-generated
/// "download assets" placeholder are skipped (heading omitted entirely).
/// Unparsable tags keep their relative order (sort comparator is Equal).
fn format_releases_markdown(
    mut releases: Vec<octocrab::models::repos::Release>,
    link_url: &str,
    link_label: &str,
    empty_message: &str,
) -> String {
    use semver::Version;

    if releases.is_empty() {
        return empty_message.to_string();
    }

    releases.sort_by(|a, b| {
        let parse_ver = |r: &octocrab::models::repos::Release| {
            Version::parse(r.tag_name.strip_prefix('v').unwrap_or(&r.tag_name)).ok()
        };
        match (parse_ver(b), parse_ver(a)) {
            (Some(vb), Some(va)) => vb.cmp(&va),
            _ => std::cmp::Ordering::Equal,
        }
    });

    let mut notes = String::new();
    const DEFAULT_BODY: &str = "See the assets to download this version and install.";

    for release in releases {
        if let Some(body) = &release.body {
            if !body.is_empty() && body != DEFAULT_BODY {
                notes.push_str(&format!("## {}\n\n{}\n\n---\n\n", release.tag_name, body));
            }
        }
    }

    notes.push_str(&format!("*View [{link_label}]({link_url}) on GitHub*\n"));

    notes
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};

    // Why: built via serde_json rather than a struct literal — octocrab's
    // Release has ~20 fields (several Url-typed, each needing Url::parse in
    // a literal) and its nested Author is #[non_exhaustive] with no
    // constructor, so JSON deserialization is the tersest fixture
    // construction; omitted Option fields deserialize as None.
    fn release(tag: &str, body: Option<&str>) -> octocrab::models::repos::Release {
        let created_at: Option<DateTime<Utc>> =
            DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
                .ok()
                .map(|d| d.with_timezone(&Utc));
        serde_json::from_value(serde_json::json!({
            "url": "https://example.com/u",
            "id": 1,
            "node_id": "rel",
            "tag_name": tag,
            "target_commitish": "main",
            "name": format!("{tag} name"),
            "body": body,
            "draft": false,
            "prerelease": false,
            "created_at": created_at,
            "published_at": created_at,
            "assets": [],
            "author": {
                "login": "j4rviscmd", "id": 1, "node_id": "n",
                "avatar_url": "https://example.com/a", "gravatar_id": "",
                "url": "https://example.com/u", "html_url": "https://example.com/u",
                "followers_url": "https://example.com/f",
                "following_url": "https://example.com/fg",
                "gists_url": "https://example.com/g",
                "starred_url": "https://example.com/s",
                "subscriptions_url": "https://example.com/sub",
                "organizations_url": "https://example.com/org",
                "repos_url": "https://example.com/repos",
                "events_url": "https://example.com/events",
                "received_events_url": "https://example.com/re",
                "type": "User", "site_admin": false
            },
            "html_url": "https://example.com/u",
            "upload_url": "https://example.com/u",
            "assets_url": "https://example.com/assets",
            "zipball_url": "https://example.com/z", "tarball_url": "https://example.com/t"
        }))
        .unwrap()
    }

    #[test]
    fn sorts_newest_first_and_renders_bodies() {
        let releases = vec![
            release("v1.0.0", Some("first")),
            release("v1.10.0", Some("semver compare, not lexicographic")),
            release("v1.2.0", Some("third")),
        ];
        let out = format_releases_markdown(releases, "https://ex/r", "latest release", "empty");
        let first_heading = out.find("## ").unwrap();
        assert!(out[first_heading..].starts_with("## v1.10.0"), "{out}");
        assert!(out.contains("## v1.2.0"));
        assert!(out.contains("## v1.0.0"));
        // v1.10.0 > v1.2.0 > v1.0.0 by semver
        assert!(out.find("## v1.10.0").unwrap() < out.find("## v1.2.0").unwrap());
        assert!(out.find("## v1.2.0").unwrap() < out.find("## v1.0.0").unwrap());
        assert!(out.contains("*View [latest release](https://ex/r) on GitHub*"));
    }

    #[test]
    fn skips_placeholder_and_missing_bodies() {
        let releases = vec![
            release("v1.1.0", None),
            release("v1.2.0", Some("")),
            release(
                "v1.3.0",
                Some("See the assets to download this version and install."),
            ),
            release("v1.4.0", Some("real")),
        ];
        let out = format_releases_markdown(releases, "u", "l", "empty");
        assert!(!out.contains("v1.1.0"));
        assert!(!out.contains("v1.2.0"));
        assert!(!out.contains("v1.3.0"));
        assert!(out.contains("## v1.4.0"));
    }

    #[test]
    fn empty_input_returns_message() {
        assert_eq!(
            format_releases_markdown(vec![], "u", "l", "No releases found."),
            "No releases found."
        );
    }

    // ---- PR⑨: fetcher + update-lock E2E (issue #646) ----
    //
    // Octocrab rides a wiremock origin (same pattern as handlers/github.rs);
    // pages are disambiguated by the `page` query param.

    use wiremock::matchers::{method, path, query_param};

    fn mock_client(base: &str) -> Octocrab {
        Octocrab::builder().base_uri(base).unwrap().build().unwrap()
    }

    // Owned tags: pages built by format! loops (range-generated semver
    // fixtures) mount directly, no &str borrow-dance at call sites.
    fn releases_body(tags_bodies: &[(String, Option<&str>)]) -> serde_json::Value {
        serde_json::json!(tags_bodies
            .iter()
            .map(|(tag, body)| {
                let r = release(tag, *body);
                serde_json::to_value(&r).unwrap()
            })
            .collect::<Vec<_>>())
    }

    async fn mount_releases_page(
        server: &wiremock::MockServer,
        page: u32,
        tags_bodies: &[(String, Option<&str>)],
    ) {
        wiremock::Mock::given(method("GET"))
            .and(path("/repos/j4rviscmd/bilibili-downloader-gui/releases"))
            .and(query_param("page", page.to_string()))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(releases_body(tags_bodies)),
            )
            .mount(server)
            .await;
    }

    async fn count_release_requests(server: &wiremock::MockServer) -> usize {
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path().ends_with("/releases"))
            .count()
    }

    #[tokio::test]
    async fn release_notes_merges_newer_versions_and_stops_on_short_page() {
        let server = wiremock::MockServer::start().await;
        // Short page (< PER_PAGE) ends the loop after page 1.
        mount_releases_page(
            &server,
            1,
            &[
                ("v1.3.0".to_string(), Some("third")),
                ("v1.2.0".to_string(), Some("second")),
            ],
        )
        .await;

        let notes = fetch_all_release_notes_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
            "1.1.0",
        )
        .await
        .unwrap();

        assert!(notes.contains("## v1.3.0"), "{notes}");
        assert!(notes.contains("## v1.2.0"), "{notes}");
        assert_eq!(
            count_release_requests(&server).await,
            1,
            "short page stops pagination"
        );
    }

    #[tokio::test]
    async fn release_notes_early_exits_when_full_page_has_nothing_newer() {
        let server = wiremock::MockServer::start().await;
        // Page 1 must be FULL (PER_PAGE items, all newer) so pagination
        // continues; page 2 is full but all-older -> any_newer early-exit.
        // Why 70..=99: every tag must parse as valid semver — leading-zero
        // patches (v1.2.01) are invalid and would be silently skipped.
        let newer: Vec<_> = (70..=99)
            .map(|i| (format!("v1.2.{i}"), Some("newer")))
            .collect();
        mount_releases_page(&server, 1, &newer).await;
        let older: Vec<_> = (70..=99)
            .map(|i| (format!("v1.0.{i}"), Some("older")))
            .collect();
        mount_releases_page(&server, 2, &older).await;

        let notes = fetch_all_release_notes_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
            "1.1.0",
        )
        .await
        .unwrap();

        assert!(notes.contains("v1.2.99"), "{notes}");
        assert!(!notes.contains("v1.0."), "all-older page excluded: {notes}");
        assert_eq!(
            count_release_requests(&server).await,
            2,
            "early-exit after an all-older full page; page 3 never requested"
        );
    }

    #[tokio::test]
    async fn release_notes_empty_page_breaks_immediately() {
        let server = wiremock::MockServer::start().await;
        mount_releases_page(&server, 1, &[]).await;

        let notes = fetch_all_release_notes_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
            "1.2.0",
        )
        .await
        .unwrap();
        assert_eq!(notes, "No new releases available");
    }

    #[tokio::test]
    async fn release_notes_rejects_unparsable_current_version() {
        let server = wiremock::MockServer::start().await;
        let err = fetch_all_release_notes_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
            "not-semver",
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("parse current version"));
        assert!(
            server.received_requests().await.unwrap().is_empty(),
            "no HTTP before the version parse"
        );
    }

    #[tokio::test]
    async fn releases_markdown_paginates_until_empty_page() {
        let server = wiremock::MockServer::start().await;
        mount_releases_page(&server, 1, &[("v1.2.0".to_string(), Some("second"))]).await;
        mount_releases_page(&server, 2, &[("v1.0.0".to_string(), Some("first"))]).await;
        // Markdown pagination only stops on an EMPTY page or >= PER_PAGE
        // accumulated releases, so an empty page 3 terminates the loop.
        mount_releases_page(&server, 3, &[]).await;

        let notes = fetch_all_releases_markdown_with(
            &mock_client(&server.uri()),
            "j4rviscmd",
            "bilibili-downloader-gui",
        )
        .await
        .unwrap();

        assert!(notes.contains("## v1.2.0"), "{notes}");
        assert!(notes.contains("## v1.0.0"), "{notes}");
        assert!(notes.contains("*View [all releases]"), "{notes}");
    }

    #[test]
    fn try_acquire_update_lock_excludes_second_holder() {
        let dir = tempfile::tempdir().unwrap();
        let lock_path = dir.path().join("update.lock");

        let first = try_acquire_update_lock(&lock_path).unwrap();
        // A second descriptor in the same process must not steal the flock.
        let err = try_acquire_update_lock(&lock_path).unwrap_err();
        assert_eq!(err, "ERR::UPDATE_IN_PROGRESS");
        drop(first);
        // Released: the next attempt succeeds.
        let second = try_acquire_update_lock(&lock_path);
        assert!(second.is_ok(), "lock is reusable after release");
    }
}
