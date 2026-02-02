/**
 * Custom hook for thumbnail cache management.
 *
 * Provides a simple interface for fetching and caching video thumbnails
 * with automatic deduplication and error handling.
 *
 * Features:
 * - Automatic cache hit detection (no redundant fetches)
 * - Duplicate request prevention during concurrent renders
 * - Automatic TTL cleanup (every 5 minutes)
 * - Manual retry capability for failed requests
 * @module history/hooks/useThumbnailCache
 */

import { useCallback, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from '@/app/store'
import { useAppDispatch } from '@/app/store'
import {
  fetchThumbnail,
  clearExpiredEntries,
  evictOldestEntries,
} from '../model/thumbnailSlice'

/**
 * Result type for useThumbnailCache hook.
 */
type UseThumbnailCacheResult = {
  /** Base64 data URL or null if not available */
  data: string | null
  /** Whether a fetch is currently in progress */
  loading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Retry fetching the thumbnail */
  retry: () => void
}

/**
 * Interval for automatic cache cleanup (5 minutes).
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000

/**
 * Custom hook to fetch and cache video thumbnails.
 *
 * @param url - The thumbnail URL to fetch. If undefined, no fetch is performed.
 * @returns Object containing cached data, loading state, error, and retry function
 *
 * @example
 * ```tsx
 * const { data: thumbnail, loading, error, retry } = useThumbnailCache(video.thumbnailUrl)
 *
 * if (loading) return <Spinner />
 * if (error) return <button onClick={retry}>Retry</button>
 * return <img src={thumbnail} alt="Video thumbnail" />
 * ```
 */
export function useThumbnailCache(url?: string): UseThumbnailCacheResult {
  const dispatch = useAppDispatch()

  // Track if this component instance initiated the fetch (for deduplication)
  const isInitiator = useRef(false)

  // Select cache entry for this URL
  const cacheEntry = useSelector((state: RootState) =>
    url ? state.thumbnailCache.cache[url] : undefined,
  )

  // Fetch function with deduplication
  const fetch = useCallback(() => {
    if (!url) return

    // Only fetch if not already loading and no valid cached data
    const shouldFetch =
      !cacheEntry || (!cacheEntry.loading && !cacheEntry.data && !cacheEntry.error)

    if (shouldFetch) {
      isInitiator.current = true
      dispatch(fetchThumbnail(url))
    }
  }, [url, cacheEntry, dispatch])

  // Retry function (ignores cache and fetches again)
  const retry = useCallback(() => {
    if (!url) return
    isInitiator.current = true
    dispatch(fetchThumbnail(url))
  }, [url, dispatch])

  // Automatic cleanup effect
  useEffect(() => {
    const cleanupTimer = setInterval(() => {
      dispatch(clearExpiredEntries())
      dispatch(evictOldestEntries())
    }, CLEANUP_INTERVAL)

    return () => clearInterval(cleanupTimer)
  }, [dispatch])

  // Fetch on mount and when URL changes
  useEffect(() => {
    fetch()
  }, [fetch])

  // Extract data from cache entry
  const data = cacheEntry?.data ?? null
  const loading = cacheEntry?.loading ?? false
  const error = cacheEntry?.error ?? null

  return { data, loading, error, retry }
}
