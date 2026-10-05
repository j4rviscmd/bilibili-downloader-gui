import { useAppDispatch, useSelector } from '@/app/store'
import { fetchPopularVideosApi } from '@/features/video-search'
import { useCallback, useEffect, useRef } from 'react'
import { appendPage, setError, setLoading } from '../model/popularFeedSlice'

/**
 * Hook driving the popular feed page.
 *
 * - Loads page 1 on mount (StrictMode-safe: a second effect run sees
 *   `loading` already true from the first).
 * - `loadMore()` fetches `page + 1`; no-ops while loading or after
 *   `noMore`. It doubles as the retry for a failed fetch (the failed
 *   page number is simply re-requested).
 */
export function usePopularFeed() {
  const dispatch = useAppDispatch()
  const reqId = useRef(0)
  const { items, page, noMore, loading, error } = useSelector(
    (state) => state.popularFeed,
  )

  const load = useCallback(
    async (pg: number) => {
      // Why: only the latest request may dispatch (rapid sentinel hits) —
      // same guard pattern as useVideoSearch.
      const id = ++reqId.current
      dispatch(setLoading(true))
      dispatch(setError(null))
      try {
        const response = await fetchPopularVideosApi(pg)
        if (id !== reqId.current) return
        dispatch(
          appendPage({
            page: response.page,
            entries: response.entries,
            // Backend synthesizes num_pages = no_more ? page : page + 1.
            noMore: response.numPages <= response.page,
          }),
        )
      } catch (e) {
        if (id !== reqId.current) return
        dispatch(setError(String(e)))
      } finally {
        if (id === reqId.current) dispatch(setLoading(false))
      }
    },
    [dispatch],
  )

  const loadMore = useCallback(() => {
    if (loading || noMore) return
    // page is 0 before the first load, so the entry fetch is also page 1.
    void load(page + 1)
  }, [load, loading, noMore, page])

  useEffect(() => {
    // Entry load: empty feed, not loading, no error yet. After a failure
    // the effect does not re-run (mount-time deps) — the retry button
    // calls loadMore instead.
    if (!loading && items.length === 0 && error === null) {
      loadMore()
    }
  }, [])

  // Why exposed: tests assert the loaded page number after fetches.
  return { items, page, noMore, loading, error, loadMore }
}
