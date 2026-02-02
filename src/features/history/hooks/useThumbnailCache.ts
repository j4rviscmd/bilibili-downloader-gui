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

import type { RootState } from '@/app/store'
import { useAppDispatch } from '@/app/store'
import { useCallback, useEffect } from 'react'
import { useSelector } from 'react-redux'
import {
  clearExpiredEntries,
  evictOldestEntries,
  fetchThumbnail,
} from '../model/thumbnailSlice'

/**
 * Result type returned by useThumbnailCache hook.
 *
 * @property data - Base64 data URL of the cached thumbnail, or null if not available
 * @property loading - Whether a fetch is currently in progress
 * @property error - Error message if fetch failed, null otherwise
 * @property retry - Function to retry fetching the thumbnail
 */
type UseThumbnailCacheResult = {
  data: string | null
  loading: boolean
  error: string | null
  retry: () => void
}

/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL = 5 * 60 * 1000

/**
 * Global cleanup timer shared across all hook instances.
 *
 * This singleton timer prevents multiple cleanup intervals when
 * the hook is used in multiple components. It persists for the
 * lifetime of the application.
 */
let cleanupTimerId: ReturnType<typeof setInterval> | null = null

/**
 * Custom hook to fetch and cache video thumbnails.
 *
 * Automatically deduplicates concurrent requests for the same URL and
 * provides loading/error states. The hook also manages periodic cleanup
 * of expired and old cache entries.
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

  const cacheEntry = useSelector((state: RootState) =>
    url ? state.thumbnailCache.cache[url] : undefined,
  )

  /**
   * Fetches the thumbnail if not already cached or loading.
   *
   * Only initiates a fetch if:
   * - URL is provided
   * - No cache entry exists, OR
   * - Entry exists but is not loading and has no data or error
   */
  const fetch = useCallback(() => {
    if (!url) return

    const shouldFetch =
      !cacheEntry ||
      (!cacheEntry.loading && !cacheEntry.data && !cacheEntry.error)

    if (shouldFetch) {
      dispatch(fetchThumbnail(url))
    }
  }, [url, cacheEntry, dispatch])

  /**
   * Retries fetching the thumbnail.
   *
   * Useful for recovering from failed fetches. Forces a new
   * fetch request regardless of current cache state.
   */
  const retry = useCallback(() => {
    if (!url) return
    dispatch(fetchThumbnail(url))
  }, [url, dispatch])

  // Fetch on mount and when URL changes
  useEffect(() => {
    fetch()
  }, [fetch])

  /**
   * Setup global cleanup timer (singleton across all hook instances).
   *
   * The timer persists for the app lifetime to periodically:
   * 1. Remove expired entries (older than TTL)
   * 2. Evict oldest entries if cache exceeds max size
   *
   * Note: Cleanup function is intentionally empty to keep timer running.
   */
  useEffect(() => {
    if (!cleanupTimerId) {
      cleanupTimerId = setInterval(() => {
        dispatch(clearExpiredEntries())
        dispatch(evictOldestEntries())
      }, CLEANUP_INTERVAL)
    }

    return () => {
      // Only clear timer if this is the last hook instance
      // In practice, we keep the timer running for the app lifetime
    }
  }, [dispatch])

  return {
    data: cacheEntry?.data ?? null,
    loading: cacheEntry?.loading ?? false,
    error: cacheEntry?.error ?? null,
    retry,
  }
}
