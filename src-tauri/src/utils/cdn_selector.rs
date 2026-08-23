//! CDN pre-selection module.
//!
//! Orders CDN URLs from best to worst before the segmented download starts,
//! so the primary request does not land on a slow P2P/MCDN edge. Combines:
//! 1. a static domain filter that removes known P2P/MCDN nodes (falling back
//!    to the original list when every candidate is P2P),
//! 2. unhealthy-host substitution — URLs whose host failed connection
//!    establishment earlier in the same download are rewritten to a healthy
//!    mirror host (see [`HostHealth`]), and
//! 3. a bounded parallel latency probe (HEAD -> 1-byte Range fallback) that
//!    also recovers the total file size.
//!
//! On total probe failure it falls back to the statically-filtered list, so
//! the existing reactive rotation in `downloads.rs` remains the final safety
//! net. All domain/sort logic lives in pure functions covered by unit tests.

use crate::constants::{CDN_PROBE_CONCURRENCY, CDN_PROBE_TIMEOUT_SECS, REFERER, USER_AGENT};
use crate::utils::downloads::{apply_cookie, is_media_content_type};
use futures::stream::{FuturesUnordered, StreamExt};
use reqwest::header;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Outcome of CDN selection.
#[derive(Debug, Clone)]
pub struct ProbeOutcome {
    /// CDN URLs ordered best-first. Falls back to the statically-filtered
    /// list when every probe fails.
    pub ordered_urls: Vec<String>,
    /// Total file size in bytes recovered during probing. `None` signals the
    /// caller to fall back to single-stream download (Range unsupported).
    pub total_size: Option<u64>,
}

/// Per-download CDN host health memory (issue #527).
///
/// Owned by the download orchestrator (`download_video`) and shared by
/// `Arc` with the video stream, audio stream(s), every retry attempt, and
/// the parallel segment tasks of that one download. Dropping the last `Arc`
/// when the download ends clears the state — no explicit cleanup, no TTL.
///
/// Two kinds of evidence are recorded:
/// - *unhealthy*: a host where connection-establishment failures exhausted
///   the same-URL HTTP retries. This is host-level evidence — slow streams,
///   HTTP statuses, or size mismatches never mark a host.
/// - *mirrors*: the pool of known-eligible mirror hosts harvested from the
///   download's own URL universe (manifest + probe results). Substitution
///   targets are drawn from this pool, never from a hardcoded list.
pub struct HostHealth {
    inner: std::sync::Mutex<HostHealthInner>,
}

#[derive(Default)]
struct HostHealthInner {
    /// Known eligible mirror hosts, insertion-ordered, deduped, lowercase.
    mirrors: Vec<String>,
    /// Hosts with connection-establishment failure evidence.
    unhealthy: HashSet<String>,
}

impl Default for HostHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl HostHealth {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(HostHealthInner::default()),
        }
    }

    /// Seeds the mirror pool from URLs (eligible `.bilivideo.com` non-P2P
    /// hosts only; idempotent; no-op for github/akamaized/etc.).
    pub fn seed_mirrors_from_urls(&self, urls: &[String]) {
        let mut inner = self.inner.lock().unwrap();
        for host in harvest_mirror_hosts(urls) {
            if !inner.mirrors.contains(&host) {
                inner.mirrors.push(host);
            }
        }
    }

    /// Marks the URL's host unhealthy and removes it from the mirror pool.
    pub fn mark_url_unhealthy(&self, url: &str) {
        if let Some(host) = extract_host(url) {
            let mut inner = self.inner.lock().unwrap();
            inner.unhealthy.insert(host.clone());
            inner.mirrors.retain(|m| *m != host);
        }
    }

    /// Records the URL's host as alive: clears an unhealthy mark and adds
    /// the host back to the mirror pool when eligible. Called from probe
    /// successes so a recovered host is trusted again.
    pub fn record_url_healthy(&self, url: &str) {
        if let Some(host) = extract_host(url) {
            let mut inner = self.inner.lock().unwrap();
            inner.unhealthy.remove(&host);
            if is_mirror_host(&host) && !inner.mirrors.contains(&host) {
                inner.mirrors.push(host);
            }
        }
    }

    /// Copy-out state for the pure decision functions.
    pub(crate) fn snapshot(&self) -> HealthSnapshot {
        let inner = self.inner.lock().unwrap();
        HealthSnapshot {
            mirrors: inner.mirrors.clone(),
            unhealthy: inner.unhealthy.clone(),
        }
    }
}

/// Point-in-time copy of [`HostHealth`] consumed by the pure substitution
/// functions (kept `pub(crate)` so `downloads.rs` can call them without
/// re-deriving state).
#[derive(Clone)]
pub(crate) struct HealthSnapshot {
    pub(crate) mirrors: Vec<String>,
    pub(crate) unhealthy: HashSet<String>,
}

/// True for hosts on the `bilivideo.com` CDN family — the only domain where
/// signed bilibili URLs are verified to work cross-host (issue #527:
/// same path+query returned 206 across `upos-sz-mirror*.bilivideo.com`,
/// while `*.akamaized.net` uses a different signing scheme and fails).
fn is_bilivideo_com_host(host: &str) -> bool {
    host.to_ascii_lowercase().ends_with(".bilivideo.com")
}

/// True for hosts eligible as substitution targets: `upos-sz-mirror*`
/// mirrors on `bilivideo.com`, excluding P2P nodes.
// Caution: this shape is deliberately narrow. Cross-host reuse of signed
// URLs was verified only for these mirrors (issue #527); do not widen
// without re-verifying that the signature still returns 206.
fn is_mirror_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    is_bilivideo_com_host(&h) && h.starts_with("upos-sz-mirror") && !is_p2p_cdn_host(&h)
}

/// Collects deduped eligible mirror hosts from a URL list, preserving order.
fn harvest_mirror_hosts(urls: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for url in urls {
        if let Some(host) = extract_host(url) {
            if is_mirror_host(&host) && seen.insert(host.clone()) {
                out.push(host);
            }
        }
    }
    out
}

/// Rewrites only the host of `url`, preserving scheme/path/query (the
/// signature). Returns `None` when `url` does not parse.
fn substitute_host(url: &str, new_host: &str) -> Option<String> {
    let mut parsed = reqwest::Url::parse(url).ok()?;
    // set_host with None port keeps scheme/path/query intact.
    parsed.set_host(Some(new_host)).ok()?;
    // Constraint: the url crate's set_host (2.5.4, set_host_internal with
    // opt_new_port: None) leaves an existing explicit port untouched, so a
    // port carried by the original host would survive the swap. Drop it —
    // mirrors serve on the scheme's default port.
    let _ = parsed.set_port(None);
    Some(parsed.to_string())
}

/// Picks a substitution target: mirrors minus unhealthy, spread by `salt`
/// so repeated substitutions distribute load across the pool.
/// Deterministic. `None` when no eligible mirror exists.
fn pick_mirror(snap: &HealthSnapshot, salt: usize) -> Option<String> {
    let eligible: Vec<&String> = snap
        .mirrors
        .iter()
        .filter(|m| !snap.unhealthy.contains(*m))
        .collect();
    if eligible.is_empty() {
        return None;
    }
    Some(eligible[salt % eligible.len()].clone())
}

/// Pre-selection layer: rewrites every URL whose host is unhealthy (and is
/// on `bilivideo.com`) to a pool mirror. No-op until at least one unhealthy
/// mark exists, so plain-P2P lists keep relying on the static filter.
/// URLs that cannot be substituted are returned unchanged — never dropped.
pub(crate) fn substitute_in_list(urls: &[String], snap: &HealthSnapshot) -> Vec<String> {
    if urls.is_empty() || snap.unhealthy.is_empty() || snap.mirrors.is_empty() {
        return urls.to_vec();
    }
    urls.iter()
        .enumerate()
        .map(|(i, url)| {
            let Some(host) = extract_host(url) else {
                return url.clone();
            };
            // Why: the second arm rewrites bilivideo.com P2P hosts that
            // carry no unhealthy mark. It only matters when the whole list
            // is P2P — otherwise filter_out_p2p (running after this) drops
            // such URLs anyway, but its all-P2P fallback would keep them
            // verbatim, so substitution must rescue that case first.
            let needs_rewrite = snap.unhealthy.contains(&host)
                || (is_bilivideo_com_host(&host) && is_p2p_cdn_host(&host));
            if !needs_rewrite || !is_bilivideo_com_host(&host) {
                return url.clone();
            }
            match pick_mirror(snap, i) {
                Some(target) => {
                    log::info!(
                        "[BE] cdn_selector: substituting unhealthy/P2P host {} -> {}",
                        host,
                        target
                    );
                    substitute_host(url, &target).unwrap_or_else(|| url.clone())
                }
                None => url.clone(),
            }
        })
        .collect()
}

/// Rotation-time layer: the URL to actually request. URLs on healthy or
/// ineligible hosts pass through byte-identical; URLs on unhealthy
/// `bilivideo.com` hosts are rewritten to a pool mirror chosen by `salt`.
pub(crate) fn resolve_effective_url(url: &str, snap: &HealthSnapshot, salt: usize) -> String {
    let Some(host) = extract_host(url) else {
        return url.to_string();
    };
    if !snap.unhealthy.contains(&host) || !is_bilivideo_com_host(&host) {
        return url.to_string();
    }
    match pick_mirror(snap, salt) {
        Some(target) => substitute_host(url, &target).unwrap_or_else(|| url.to_string()),
        None => url.to_string(),
    }
}

/// Per-CDN probe result. Carries `original_index` for stable tie-breaking.
#[derive(Debug, Clone)]
struct ProbeResult {
    url: String,
    /// Position in the statically-filtered input (for stable sort).
    original_index: usize,
    /// Measured round-trip latency. `None` means the probe failed
    /// (timeout, non-media response, or connection error).
    latency_ms: Option<u64>,
    /// Total size recovered from Content-Length / Content-Range.
    size: Option<u64>,
}

// Constraint: Only `mcdn` is matched here rather than a broader P2P blacklist
//   (e.g. pcdn) because the play API already returns stable `upos-sz-mirror*`
//   mirrors via backup_urls, so excluding the primary mcdn node alone is
//   sufficient — confirmed by the mirror hosts used in the unit tests below
//   (issue #490).
/// Returns true when the host is a known P2P/MCDN edge.
///
/// bilibili serves the primary `baseUrl` from `*.mcdn.bilivideo.cn`, a
/// P2P/MCDN node that is frequently bandwidth-limited and is the main cause
/// of slow downloads. Pure function — no HTTP, no I/O.
fn is_p2p_cdn_host(host: &str) -> bool {
    host.to_ascii_lowercase().contains("mcdn")
}

/// Extracts the lowercased host from a URL string. Returns `None` on parse
/// failure (the caller treats unparseable URLs as non-P2P).
pub(crate) fn extract_host(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
}

/// Filters out known P2P/MCDN nodes from the CDN candidate list.
///
/// P2P/MCDN edges (e.g. `*.mcdn.bilivideo.cn`) are bandwidth-limited: once
/// the reactive rotation lands on them it only detects slowness and moves
/// off, wasting time. They are therefore excluded up front rather than
/// demoted. When every candidate is P2P (no non-P2P node available), the
/// original list is returned so the download can still proceed instead of
/// failing. Pure function — fully unit-testable.
fn filter_out_p2p(urls: &[String]) -> Vec<String> {
    let filtered: Vec<String> = urls
        .iter()
        .filter(|u| !is_p2p_cdn_host(&extract_host(u).unwrap_or_default()))
        .cloned()
        .collect();
    if filtered.is_empty() {
        // All candidates are P2P — keep them rather than failing.
        urls.to_vec()
    } else {
        filtered
    }
}

/// Orders probe results by latency ascending; failed probes go last.
///
/// Successful probes are sorted by `latency_ms` with `original_index` as a
/// stable tie-breaker (so equal-latency CDNs keep their pre-probe order).
/// Failed probes (`latency_ms` None) are appended in `original_index` order.
/// Pure function — fully unit-testable.
fn sort_by_latency(results: Vec<ProbeResult>) -> Vec<ProbeResult> {
    let (mut successful, mut failed): (Vec<_>, Vec<_>) =
        results.into_iter().partition(|r| r.latency_ms.is_some());

    successful.sort_by(|a, b| {
        a.latency_ms
            .unwrap_or(u64::MAX)
            .cmp(&b.latency_ms.unwrap_or(u64::MAX))
            .then_with(|| a.original_index.cmp(&b.original_index))
    });
    failed.sort_by_key(|r| r.original_index);

    successful.extend(failed);
    successful
}

/// Probes a single CDN URL for reachability, size, and latency.
///
/// Tries a HEAD request first; falls back to a 1-byte Range request
/// (`bytes=0-0`) when the HEAD response lacks a usable Content-Length. A
/// `latency_ms` of `None` marks the probe as failed (non-fatal — the URL is
/// simply deprioritized and the existing reactive rotation can still reach it).
async fn probe_single(
    client: &reqwest::Client,
    url: &str,
    original_index: usize,
    cookie: &Option<String>,
) -> ProbeResult {
    // Caution: latency is measured at whichever stage first succeeds — HEAD RTT
    //   for CDNs that answer HEAD, Range-GET RTT for those that only answer the
    //   Range fallback. Cross-CDN comparison therefore mixes two measurement
    //   phases, so treat the latency ordering as a coarse signal, not exact.
    let head_start = Instant::now();

    let head_req = apply_cookie(
        client
            .head(url)
            .header(header::REFERER, REFERER)
            .timeout(Duration::from_secs(CDN_PROBE_TIMEOUT_SECS)),
        cookie,
    );

    let mut latency_ms: Option<u64> = None;
    let mut size: Option<u64> = None;

    if let Ok(resp) = head_req.send().await {
        if resp.status().is_success()
            && is_media_content_type(resp.headers().get(header::CONTENT_TYPE))
        {
            latency_ms = Some(head_start.elapsed().as_millis() as u64);
            if let Some(val) = resp
                .headers()
                .get(header::CONTENT_LENGTH)
                .and_then(|len| len.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
            {
                size = Some(val);
            }
        }
    }

    // Range fallback when HEAD did not yield a size.
    if size.is_none() {
        let range_start = Instant::now();
        let range_req = apply_cookie(
            client
                .get(url)
                .header(header::RANGE, "bytes=0-0")
                .header(header::REFERER, REFERER)
                .timeout(Duration::from_secs(CDN_PROBE_TIMEOUT_SECS)),
            cookie,
        );
        if let Ok(resp) = range_req.send().await {
            if resp.status().is_success()
                && is_media_content_type(resp.headers().get(header::CONTENT_TYPE))
            {
                if latency_ms.is_none() {
                    latency_ms = Some(range_start.elapsed().as_millis() as u64);
                }
                // Content-Range: "bytes START-END/TOTAL"
                if let Some(total) = resp
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .and_then(|cr| cr.to_str().ok())
                    .and_then(|s| s.rsplit('/').next())
                    .and_then(|v| v.parse::<u64>().ok())
                {
                    size = Some(total);
                }
            }
        }
    }

    ProbeResult {
        url: url.to_string(),
        original_index,
        latency_ms,
        size,
    }
}

/// Selects and ranks CDN URLs via static filtering + parallel latency probe.
///
/// Pipeline:
/// 1. Seed the shared mirror pool from this URL list, then substitute hosts
///    marked unhealthy in `health` with healthy pool mirrors.
/// 2. Statically filter out P2P/MCDN nodes (fall back to original list when
///    every candidate is P2P).
/// 3. Probe every URL in parallel, bounded by `CDN_PROBE_CONCURRENCY`;
///    successful probes record their host healthy (recovery).
/// 4. Sort by latency (failed probes last).
/// 5. Recover the total size from the first successful probe.
/// 6. Fallback: if no probe succeeded, keep the statically-filtered list.
pub async fn select_best_cdns(
    urls: Vec<String>,
    cookie: Option<String>,
    health: &HostHealth,
) -> ProbeOutcome {
    log::info!("[BE] select_best_cdns: {} candidate CDNs", urls.len());

    if urls.is_empty() {
        return ProbeOutcome {
            ordered_urls: urls,
            total_size: None,
        };
    }

    // 1a. Self-seed the mirror pool so every download_url call is
    // self-contained (durl/bangumi/audio-fallback paths pass only URLs).
    health.seed_mirrors_from_urls(&urls);

    // 1b. Rewrite unhealthy hosts to healthy mirrors before probing, so a
    // retry attempt does not burn its HTTP retries on a known-dead host.
    let substituted = substitute_in_list(&urls, &health.snapshot());

    // 2. Static filtering of P2P/MCDN nodes.
    let candidates = filter_out_p2p(&substituted);
    let removed = substituted.len() - candidates.len();
    log::info!(
        "[BE] select_best_cdns: static filter removed {} P2P CDN(s), {} remain = {:?}",
        removed,
        candidates.len(),
        candidates
            .iter()
            .map(|u| extract_host(u).unwrap_or_default())
            .collect::<Vec<_>>()
    );

    // 2. Short-timeout probe client (independent of the 120s DL client).
    // Why: probes must fail fast (CDN_PROBE_TIMEOUT_SECS) so a dead or slow CDN
    //   node does not add the 120s download-client timeout to pre-selection
    //   latency, which would defeat the purpose of ranking by responsiveness.
    let client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(CDN_PROBE_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::error!("[BE] select_best_cdns: probe client build failed: {}", e);
            return ProbeOutcome {
                ordered_urls: candidates,
                total_size: None,
            };
        }
    };

    // 3. Parallel probe (bounded concurrency).
    let semaphore = Arc::new(tokio::sync::Semaphore::new(CDN_PROBE_CONCURRENCY));
    let mut futs = FuturesUnordered::new();
    for (idx, url) in candidates.iter().enumerate() {
        let permit = semaphore.clone();
        let client = client.clone();
        let cookie = cookie.clone();
        let url = url.clone();
        futs.push(async move {
            // A permit failure (closed semaphore) is non-fatal: skip this URL.
            let _permit = permit.acquire().await.ok()?;
            Some(probe_single(&client, &url, idx, &cookie).await)
        });
    }

    let mut results: Vec<ProbeResult> = Vec::new();
    while let Some(r) = futs.next().await {
        if let Some(res) = r {
            results.push(res);
        }
    }

    // 3b. Successful probes count as host-recovery evidence: an unhealthy
    // mark is cleared and the host re-enters the mirror pool.
    for r in &results {
        if r.latency_ms.is_some() {
            health.record_url_healthy(&r.url);
        }
    }

    // 4. Sort by latency (failed last).
    let sorted = sort_by_latency(results);

    // Total size = first successful probe's size.
    // Note: every CDN serves the same stream, so the fastest probe's size (first
    //   after the latency sort) is authoritative; trusting a failed/slow probe's
    //   size could feed a wrong total to segmentation.
    let total_size = sorted.iter().find_map(|r| r.size);
    // Defensive: if probing yielded no results at all (e.g. the probe
    // semaphore was closed), keep the statically-filtered list. Normal total
    // failures are already handled by sort_by_latency (failed probes keep
    // their static order at the tail).
    let ordered_urls: Vec<String> = if sorted.is_empty() {
        candidates.clone()
    } else {
        sorted.iter().map(|r| r.url.clone()).collect()
    };

    // Trace per-CDN probe latency alongside the final order so the
    //   "fast CDN ranked first" assumption can be checked against actual
    //   download throughput observed in download_segment logs.
    log::info!(
        "[BE] select_best_cdns: done, ordered_hosts_with_latency={:?}, total_size={:?}",
        sorted
            .iter()
            .map(|r| (
                extract_host(&r.url).unwrap_or_default(),
                r.latency_ms
                    .map_or("-".to_string(), |ms| format!("{}ms", ms)),
            ))
            .collect::<Vec<_>>(),
        total_size
    );

    ProbeOutcome {
        ordered_urls,
        total_size,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_p2p_cdn_host_mcdn() {
        assert!(is_p2p_cdn_host("xy183x232x115.mcdn.bilivideo.cn"));
        assert!(is_p2p_cdn_host("MCDN.bilivideo.com")); // case-insensitive
    }

    #[test]
    fn test_is_p2p_cdn_host_non_p2p() {
        assert!(!is_p2p_cdn_host("upos-sz-mirrorcos.bilivideo.com"));
        assert!(!is_p2p_cdn_host("upos-sz-mirrorhw.bilivideo.com"));
        assert!(!is_p2p_cdn_host(""));
    }

    #[test]
    fn test_filter_out_p2p_removes_p2p() {
        let urls = vec![
            "https://xy183.mcdn.bilivideo.cn/a".to_string(),
            "https://upos-sz-mirrorcos.bilivideo.com/b".to_string(),
        ];
        let r = filter_out_p2p(&urls);
        assert_eq!(r.len(), 1, "P2P must be removed");
        assert!(r[0].contains("mirrorcos"));
    }

    #[test]
    fn test_filter_out_p2p_preserves_non_p2p_order() {
        let urls = vec![
            "https://upos-sz-mirrorhw.bilivideo.com/a".to_string(), // non-p2p #1
            "https://upos-sz-mirrorcos.bilivideo.com/b".to_string(), // non-p2p #2
            "https://mcdn.bilivideo.cn/c".to_string(),              // p2p (dropped)
        ];
        let r = filter_out_p2p(&urls);
        assert_eq!(r.len(), 2);
        assert!(r[0].contains("/a"));
        assert!(r[1].contains("/b"));
    }

    #[test]
    fn test_filter_out_p2p_fallback_when_all_p2p() {
        // When every candidate is P2P, keep them rather than failing.
        let urls = vec![
            "https://mcdn.bilivideo.cn/a".to_string(),
            "https://mcdn.bilivideo.cn/b".to_string(),
        ];
        let r = filter_out_p2p(&urls);
        assert_eq!(r.len(), 2, "all-P2P must fall back to original list");
    }

    #[test]
    fn test_filter_out_p2p_empty() {
        assert!(filter_out_p2p(&[]).is_empty());
    }

    #[test]
    fn test_sort_by_latency_ascending() {
        let results = vec![
            ProbeResult {
                url: "a".into(),
                original_index: 0,
                latency_ms: Some(200),
                size: None,
            },
            ProbeResult {
                url: "b".into(),
                original_index: 1,
                latency_ms: Some(50),
                size: None,
            },
            ProbeResult {
                url: "c".into(),
                original_index: 2,
                latency_ms: Some(150),
                size: None,
            },
        ];
        let sorted = sort_by_latency(results);
        assert_eq!(sorted[0].url, "b");
        assert_eq!(sorted[1].url, "c");
        assert_eq!(sorted[2].url, "a");
    }

    #[test]
    fn test_sort_by_latency_failed_go_last() {
        let results = vec![
            ProbeResult {
                url: "fast".into(),
                original_index: 0,
                latency_ms: Some(100),
                size: None,
            },
            ProbeResult {
                url: "dead".into(),
                original_index: 1,
                latency_ms: None,
                size: None,
            },
        ];
        let sorted = sort_by_latency(results);
        assert_eq!(sorted[0].url, "fast");
        assert_eq!(sorted[1].url, "dead");
    }

    #[test]
    fn test_sort_by_latency_equal_latency_uses_original_index() {
        let results = vec![
            ProbeResult {
                url: "first".into(),
                original_index: 1,
                latency_ms: Some(100),
                size: None,
            },
            ProbeResult {
                url: "second".into(),
                original_index: 0,
                latency_ms: Some(100),
                size: None,
            },
        ];
        let sorted = sort_by_latency(results);
        assert_eq!(sorted[0].url, "second", "lower original_index wins on tie");
        assert_eq!(sorted[1].url, "first");
    }

    #[test]
    fn test_extract_host() {
        assert_eq!(
            extract_host("https://upos-sz-mirrorcos.bilivideo.com/x"),
            Some("upos-sz-mirrorcos.bilivideo.com".into())
        );
        assert!(extract_host("not a url").is_none());
    }

    #[test]
    fn test_is_media_content_type() {
        assert!(is_media_content_type(None));
        assert!(is_media_content_type(Some(&to_hv("video/mp4"))));
        assert!(!is_media_content_type(Some(&to_hv("application/json"))));
        assert!(!is_media_content_type(Some(&to_hv("text/html"))));
    }

    fn to_hv(s: &str) -> header::HeaderValue {
        header::HeaderValue::from_str(s).unwrap()
    }

    const SIGNED_URL_A: &str = "https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/57/23/1/1-30280.m4s?e=ig8eu&deadline=1787467312&upsig=abc&platform=pc";
    const SIGNED_URL_B: &str = "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/57/23/1/1-30280.m4s?e=ig8eu&deadline=1787467312&upsig=abc&platform=pc";
    const MIRROR_COS: &str = "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/57/23/1/1-30280.m4s?e=ig8eu&deadline=1787467312&upsig=abc&platform=pc";

    fn snap(mirrors: &[&str], unhealthy: &[&str]) -> HealthSnapshot {
        HealthSnapshot {
            mirrors: mirrors.iter().map(|s| s.to_string()).collect(),
            unhealthy: unhealthy.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn test_is_bilivideo_com_host() {
        assert!(is_bilivideo_com_host("upos-sz-mirrorcos.bilivideo.com"));
        assert!(is_bilivideo_com_host(
            "upos-hz-mirrorakam.akamaized.net.bilivideo.com"
        ));
        assert!(!is_bilivideo_com_host("xy.mcdn.bilivideo.cn"));
        assert!(!is_bilivideo_com_host("upos-hz-mirrorakam.akamaized.net"));
        assert!(!is_bilivideo_com_host("bilivideo.com"));
    }

    #[test]
    fn test_substitute_host_preserves_path_and_query() {
        let rewritten = substitute_host(SIGNED_URL_A, "upos-sz-mirrorhw.bilivideo.com").unwrap();
        let orig = reqwest::Url::parse(SIGNED_URL_A).unwrap();
        let new = reqwest::Url::parse(&rewritten).unwrap();
        assert_eq!(new.host_str().unwrap(), "upos-sz-mirrorhw.bilivideo.com");
        assert_eq!(new.path(), orig.path());
        assert_eq!(new.query(), orig.query());
        assert!(substitute_host("not a url", "x").is_none());
    }

    #[test]
    fn test_substitute_in_list_rewrites_unhealthy() {
        let s = snap(
            &["upos-sz-mirrorhw.bilivideo.com"],
            &["upos-sz-mirrorcosov.bilivideo.com"],
        );
        let out = substitute_in_list(&[SIGNED_URL_A.to_string(), MIRROR_COS.to_string()], &s);
        assert!(out[0].contains("upos-sz-mirrorhw.bilivideo.com"));
        assert_eq!(out[1], MIRROR_COS, "healthy URL passes through unchanged");
    }

    #[test]
    fn test_substitute_in_list_skips_non_bilivideo_source() {
        let s = snap(
            &["upos-sz-mirrorhw.bilivideo.com"],
            &["upos-hz-mirrorakam.akamaized.net"],
        );
        let out = substitute_in_list(&[SIGNED_URL_B.to_string()], &s);
        assert_eq!(out[0], SIGNED_URL_B, "akamaized source is never rewritten");
    }

    #[test]
    fn test_substitute_in_list_noop_when_pool_empty() {
        let s = snap(&[], &["upos-sz-mirrorcosov.bilivideo.com"]);
        let out = substitute_in_list(&[SIGNED_URL_A.to_string()], &s);
        assert_eq!(out[0], SIGNED_URL_A);
    }

    #[test]
    fn test_substitute_in_list_all_unhealthy_is_noop() {
        let host = "upos-sz-mirrorcosov.bilivideo.com";
        let s = snap(&[host], &[host]);
        let out = substitute_in_list(&[SIGNED_URL_A.to_string()], &s);
        assert_eq!(
            out[0], SIGNED_URL_A,
            "target must never be unhealthy itself"
        );
    }

    #[test]
    fn test_resolve_effective_url_healthy_passthrough() {
        let s = snap(&["upos-sz-mirrorhw.bilivideo.com"], &[]);
        assert_eq!(resolve_effective_url(SIGNED_URL_A, &s, 0), SIGNED_URL_A);
    }

    #[test]
    fn test_resolve_effective_url_rotates_mirrors_by_salt() {
        let s = snap(
            &[
                "upos-sz-mirrorhw.bilivideo.com",
                "upos-sz-mirror08c.bilivideo.com",
            ],
            &["upos-sz-mirrorcosov.bilivideo.com"],
        );
        let a = resolve_effective_url(SIGNED_URL_A, &s, 0);
        let b = resolve_effective_url(SIGNED_URL_A, &s, 1);
        assert!(a.contains("upos-sz-mirrorhw.bilivideo.com"));
        assert!(b.contains("upos-sz-mirror08c.bilivideo.com"));
    }

    #[test]
    fn test_harvest_mirror_hosts_dedupes_and_filters() {
        let urls = vec![
            SIGNED_URL_A.to_string(),
            SIGNED_URL_A.to_string(),
            MIRROR_COS.to_string(),
            SIGNED_URL_B.to_string(),
            "https://xy.mcdn.bilivideo.com/a".to_string(),
        ];
        let hosts = harvest_mirror_hosts(&urls);
        assert_eq!(hosts.len(), 2);
        assert!(hosts.contains(&"upos-sz-mirrorcosov.bilivideo.com".to_string()));
        assert!(hosts.contains(&"upos-sz-mirrorcos.bilivideo.com".to_string()));
    }

    #[test]
    fn test_host_health_mark_seed_recover() {
        let h = HostHealth::new();
        h.seed_mirrors_from_urls(&[SIGNED_URL_A.to_string(), SIGNED_URL_B.to_string()]);
        let s = h.snapshot();
        assert_eq!(
            s.mirrors.len(),
            1,
            "only bilivideo.com upos mirrors are seeded"
        );
        assert!(s.unhealthy.is_empty());

        h.mark_url_unhealthy(SIGNED_URL_A);
        let s = h.snapshot();
        assert!(s.unhealthy.contains("upos-sz-mirrorcosov.bilivideo.com"));
        assert!(
            s.mirrors.is_empty(),
            "marking removes the host from the pool"
        );

        // Recovery: a successful probe clears the mark and re-adds the pool.
        h.record_url_healthy(SIGNED_URL_A);
        let s = h.snapshot();
        assert!(s.unhealthy.is_empty());
        assert_eq!(s.mirrors.len(), 1);
    }

    #[test]
    fn test_host_health_seed_is_idempotent() {
        let h = HostHealth::new();
        h.seed_mirrors_from_urls(&[MIRROR_COS.to_string()]);
        h.seed_mirrors_from_urls(&[MIRROR_COS.to_string()]);
        assert_eq!(h.snapshot().mirrors.len(), 1);
    }
}
