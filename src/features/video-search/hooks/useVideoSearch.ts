import { useAppDispatch, useSelector } from '@/app/store'
import { useCallback, useRef } from 'react'
import { searchVideosApi } from '../api/searchVideos'
import {
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
  /** Starts a fresh search at page 1 (blank keywords ignored). */
  search: (kw: string) => void
  /** Re-runs the last keyword at the given page. */
  goToPage: (pg: number) => void
  /** Patches filters and re-runs the last keyword at page 1 (no-op before
   * the first search — the bar renders disabled then). */
  setFilter: (patch: Partial<VideoSearchFilters>) => void
}

/**
 * Hook driving the keyword video search page.
 *
 * - `search(keyword)` starts a fresh search (page 1) with the active
 *   filters; blank keywords are ignored (the backend would reject them
 *   with ERR::SEARCH_KEYWORD_EMPTY).
 * - `goToPage(n)` re-runs the last submitted keyword at page n.
 * - `setFilter(patch)` applies a filter change and re-searches at page 1 —
 *   the bilibili search page applies filters immediately.
 */
export function useVideoSearch(): VideoSearchView {
  const dispatch = useAppDispatch()
  const reqId = useRef(0)
  const { keyword, page, filters, results, loading, error } = useSelector(
    (state) => state.videoSearch,
  )

  const run = useCallback(
    async (kw: string, pg: number, f: VideoSearchFilters) => {
      // Why: a slower earlier request must not clobber a newer one (quick
      // re-search or rapid pagination clicks) — only the latest applies.
      const id = ++reqId.current
      dispatch(setLoading(true))
      dispatch(setError(null))
      try {
        const response = await searchVideosApi(kw, pg, f)
        if (id !== reqId.current) return
        dispatch(setResult({ keyword: kw, page: pg, response }))
      } catch (e) {
        if (id !== reqId.current) return
        dispatch(setError(String(e)))
      } finally {
        if (id === reqId.current) dispatch(setLoading(false))
      }
    },
    [dispatch],
  )

  const search = useCallback(
    (kw: string) => {
      const trimmed = kw.trim()
      if (!trimmed) return
      void run(trimmed, 1, filters)
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
    search,
    goToPage,
    setFilter: applyFilter,
  }
}
