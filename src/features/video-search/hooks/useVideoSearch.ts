import { useAppDispatch, useSelector } from '@/app/store'
import { useCallback, useRef } from 'react'
import { searchVideosApi } from '../api/searchVideos'
import {
  cacheStore,
  searchCacheKey,
  setError,
  setFilter,
  setLoading,
  setResult,
} from '../model/videoSearchSlice'
import type { VideoSearchEntry, VideoSearchFilters } from '../types'

/** View state and actions exposed by {@link useVideoSearch}. */
export interface VideoSearchView {
  /** Last submitted keyword ('' before the first search). */
  keyword: string
  page: number
  /** Active filters (persist across keyword changes, bilibili behavior). */
  filters: VideoSearchFilters
  numPages: number
  numResults: number
  entries: VideoSearchEntry[]
  loading: boolean
  error: string | null
  /** True once a keyword search is in flight or finished (success OR
   * failure — a failed first search keeps the page mounted so its error
   * alert shows instead of bouncing to /popular). */
  searchStarted: boolean
  /** Starts a search at page 1 (blank keywords ignored). `fresh: true`
   * bypasses the session cache — the same-keyword resubmit refresh path. */
  search: (kw: string, opts?: { fresh?: boolean }) => void
  /** Re-runs the last keyword at the given page. */
  goToPage: (pg: number) => void
  /** Patches filters and re-runs the last keyword at page 1 (no-op before
   * the first search — the bar renders disabled then). */
  setFilter: (patch: Partial<VideoSearchFilters>) => void
}

/**
 * Hook driving the keyword video search page.
 *
 * - `search(keyword)` starts a search (page 1) with the active filters;
 *   blank keywords are ignored (the backend would reject them with
 *   ERR::SEARCH_KEYWORD_EMPTY). A cached response (same keyword+page+
 *   filters, this session) is reused instead of refetching — history
 *   back/forward hits this. `fresh: true` skips the cache (retry after a
 *   failure, or an intentional refresh of the current keyword).
 * - `goToPage(n)` re-runs the last submitted keyword at page n (cached
 *   pages render instantly).
 * - `setFilter(patch)` applies a filter change and re-searches at page 1 —
 *   the bilibili search page applies filters immediately.
 */
export function useVideoSearch(): VideoSearchView {
  const dispatch = useAppDispatch()
  const reqId = useRef(0)
  const { keyword, page, filters, results, loading, error, cache } =
    useSelector((state) => state.videoSearch)

  const run = useCallback(
    async (kw: string, pg: number, f: VideoSearchFilters, fresh = false) => {
      const key = searchCacheKey(kw, pg, f)
      // Cache hit: dispatch synchronously — no loading flicker, no request.
      // Only an intentional fresh run skips this.
      if (!fresh) {
        const cached = cache[key]
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
      }
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
      void run(trimmed, 1, filters, opts?.fresh ?? false)
    },
    [filters, run],
  )

  const goToPage = useCallback(
    (pg: number) => {
      if (!keyword) return
      void run(keyword, pg, filters)
    },
    [filters, keyword, run],
  )

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
    entries: results?.entries ?? [],
    loading,
    error,
    searchStarted: loading || results !== null || error !== null,
    search,
    goToPage,
    setFilter: applyFilter,
  }
}
