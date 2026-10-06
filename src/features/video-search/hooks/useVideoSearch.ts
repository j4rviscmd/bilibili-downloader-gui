import { useAppDispatch, useSelector } from '@/app/store'
import { useCallback, useRef } from 'react'
import { searchVideosApi } from '../api/searchVideos'
import {
  cacheStore,
  resetEntries,
  restoreFeed,
  searchCacheKey,
  setError,
  setFilter,
  setLoading,
  setResult,
} from '../model/videoSearchSlice'
import type {
  VideoSearchEntry,
  VideoSearchFeed,
  VideoSearchFilters,
} from '../types'

/** View state and actions exposed by {@link useVideoSearch}. */
export interface VideoSearchView {
  /** Last submitted keyword ('' before the first search). */
  keyword: string
  page: number
  /** Active filters (persist toward new keywords; a visited keyword
   * restores its own — see the slice's filters doc). */
  filters: VideoSearchFilters
  numPages: number
  numResults: number
  /** Result cards accumulated across loaded pages (deduped by bvid). */
  entries: VideoSearchEntry[]
  /** Accumulated feed per visited keyword (the stack). The page renders
   * one scroll container per entry so switching keywords preserves the
   * loaded cards and scroll position. */
  feeds: Record<string, VideoSearchFeed>
  /** True once the last loaded page reached numPages — the list drops
   * its sentinel and stops auto-loading. */
  noMore: boolean
  loading: boolean
  error: string | null
  /** True once a keyword search is in flight or finished (success OR
   * failure — a failed first search keeps the page mounted so its error
   * alert shows instead of bouncing to /popular). */
  searchStarted: boolean
  /** Starts a search at page 1 (blank keywords ignored). `fresh: true`
   * bypasses the session cache — the same-keyword resubmit refresh path. */
  search: (kw: string, opts?: { fresh?: boolean }) => void
  /** Loads the next page of the current keyword and appends its cards.
   * No-op while loading, before the first search, or past the last
   * page. Doubles as the retry for a failed page (the failed page
   * number is simply re-requested). */
  loadMore: () => void
  /** Patches filters and re-runs the last keyword at page 1 (no-op before
   * the first search — the bar renders disabled then). */
  setFilter: (patch: Partial<VideoSearchFilters>) => void
}

/**
 * Hook driving the keyword video search page.
 *
 * - `search(keyword)` starts a search (page 1) with the active filters;
 *   blank keywords are ignored (the backend would reject them with
 *   ERR::SEARCH_KEYWORD_EMPTY). A previously visited keyword restores
 *   its stacked feed synchronously (no refetch — the page's per-keyword
 *   scroll container keeps the cards and scroll position). A cached
 *   response (same keyword+page+filters, this session) is reused instead
 *   of refetching; `fresh: true` skips both (retry after a failure, or
 *   an intentional refresh of the current keyword).
 * - `loadMore()` fetches `page + 1` and appends its cards (infinite
 *   scroll); a failed page is simply re-requested on the next call.
 * - `setFilter(patch)` applies a filter change and re-searches at page 1 —
 *   the bilibili search page applies filters immediately.
 */
export function useVideoSearch(): VideoSearchView {
  const dispatch = useAppDispatch()
  const reqId = useRef(0)
  const {
    keyword,
    page,
    filters,
    results,
    entries,
    feeds,
    loading,
    error,
    cache,
  } = useSelector((state) => state.videoSearch)

  const run = useCallback(
    async (kw: string, pg: number, f: VideoSearchFilters, fresh = false) => {
      const key = searchCacheKey(kw, pg, f)
      // Cache hit: dispatch synchronously — no loading flicker, no request.
      // Only an intentional fresh run skips this.
      const cached = fresh ? undefined : cache[key]
      if (cached) {
        // Why bump reqId: without it a slower in-flight request stays
        // authoritative and clobbers this restored result when it
        // resolves (rapid pagination back to a cached page). And
        // setLoading(false) because that request's reqId-guarded
        // finally no longer runs to clear the spinner.
        ++reqId.current
        dispatch(setResult({ keyword: kw, page: pg, response: cached }))
        dispatch(setLoading(false))
        return
      }
      // Why reset before a fresh page-1 fetch (not the cache hit above):
      // the list falls back to its skeleton while the new results are in
      // flight, so the previous keyword's cards never linger as if they
      // were the answer. Cache hits replace synchronously instead.
      if (pg === 1) dispatch(resetEntries())
      // Why: a slower earlier request must not clobber a newer one (quick
      // re-search or rapid pagination clicks) — only the latest applies.
      const id = ++reqId.current
      dispatch(setLoading(true))
      dispatch(setError(null))
      try {
        const response = await searchVideosApi(kw, pg, f)
        if (id !== reqId.current) return
        dispatch(setResult({ keyword: kw, page: pg, response }))
        dispatch(cacheStore({ key, response }))
      } catch (e) {
        if (id !== reqId.current) return
        dispatch(setError(String(e)))
      } finally {
        if (id === reqId.current) dispatch(setLoading(false))
      }
    },
    [cache, dispatch],
  )

  const search = useCallback(
    (kw: string, opts?: { fresh?: boolean }) => {
      const trimmed = kw.trim()
      if (!trimmed) return
      // Visited keyword: restore its stacked feed synchronously — the
      // cards (and their scroll container) are already loaded, so no
      // refetch and no skeleton flash. `fresh` (same-keyword resubmit)
      // intentionally bypasses this.
      const stored = opts?.fresh ? undefined : feeds[trimmed]
      if (stored) {
        // Why bump reqId (same as the cache-hit path in run): without
        // it a slower in-flight request for the previous feed stays
        // authoritative and clobbers the restored one when it resolves.
        ++reqId.current
        dispatch(restoreFeed({ keyword: trimmed, feed: stored }))
        return
      }
      void run(trimmed, 1, filters, opts?.fresh)
    },
    [dispatch, feeds, filters, run],
  )

  const noMore = results ? page >= results.numPages : true
  const loadMore = useCallback(() => {
    if (!keyword || loading || noMore) return
    void run(keyword, page + 1, filters)
  }, [filters, keyword, loading, noMore, page, run])

  const applyFilter = useCallback(
    (patch: Partial<VideoSearchFilters>) => {
      // Why: the request must carry the merged filters — re-reading the
      // slice here would race the dispatch. (The closure can still be one
      // render behind on same-tick changes; the reqId guard keeps the
      // last request authoritative.)
      const merged = { ...filters, ...patch }
      dispatch(setFilter(patch))
      if (!keyword) return
      void run(keyword, 1, merged)
    },
    [dispatch, filters, keyword, run],
  )

  return {
    keyword,
    page,
    filters,
    numPages: results?.numPages ?? 0,
    numResults: results?.numResults ?? 0,
    entries,
    feeds,
    noMore,
    loading,
    error,
    searchStarted: loading || results !== null || error !== null,
    search,
    loadMore,
    setFilter: applyFilter,
  }
}
