//! CDN pre-selection module.
//!
//! Orders CDN URLs from best to worst before the segmented download starts,
//! so the primary request does not land on a slow P2P/MCDN edge. Combines:
//! 1. a static domain filter that removes known P2P/MCDN nodes (falling back
//!    to the original list when every candidate is P2P), and
//! 2. a bounded parallel latency probe (HEAD -> 1-byte Range fallback) that
//!    also recovers the total file size.
//!
//! On total probe failure it falls back to the statically-filtered list, so
//! the existing reactive rotation in `downloads.rs` remains the final safety
//! net. All domain/sort logic lives in pure functions covered by unit tests.

use crate::constants::{CDN_PROBE_CONCURRENCY, CDN_PROBE_TIMEOUT_SECS, REFERER, USER_AGENT};
use crate::utils::downloads::is_media_content_type;
use futures::stream::{FuturesUnordered, StreamExt};
use reqwest::header;
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
fn extract_host(url: &str) -> Option<String> {
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

    let mut head_req = client
        .head(url)
        .header(header::REFERER, REFERER)
        .timeout(Duration::from_secs(CDN_PROBE_TIMEOUT_SECS));
    if let Some(c) = cookie {
        head_req = head_req.header(header::COOKIE, c);
    }

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
        let mut range_req = client
            .get(url)
            .header(header::RANGE, "bytes=0-0")
            .header(header::REFERER, REFERER)
            .timeout(Duration::from_secs(CDN_PROBE_TIMEOUT_SECS));
        if let Some(c) = cookie {
            range_req = range_req.header(header::COOKIE, c);
        }
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
/// 1. Statically filter out P2P/MCDN nodes (fall back to original list when
///    every candidate is P2P).
/// 2. Probe every URL in parallel, bounded by `CDN_PROBE_CONCURRENCY`.
/// 3. Sort by latency (failed probes last).
/// 4. Recover the total size from the first successful probe.
/// 5. Fallback: if no probe succeeded, keep the statically-filtered list.
pub async fn select_best_cdns(urls: Vec<String>, cookie: Option<String>) -> ProbeOutcome {
    log::info!("[BE] select_best_cdns: {} candidate CDNs", urls.len());

    if urls.is_empty() {
        return ProbeOutcome {
            ordered_urls: urls,
            total_size: None,
        };
    }

    // 1. Static filtering of P2P/MCDN nodes.
    let candidates = filter_out_p2p(&urls);
    let removed = urls.len() - candidates.len();
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

    log::info!(
        "[BE] select_best_cdns: done, ordered_hosts={:?}, total_size={:?}",
        ordered_urls
            .iter()
            .map(|u| extract_host(u).unwrap_or_default())
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
}
