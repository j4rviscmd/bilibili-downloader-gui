/**
 * GitHub Stars Cache Utility
 *
 * Provides localStorage-based caching for GitHub repository star counts
 * to avoid hitting GitHub API rate limits (60 requests/hour for unauthenticated requests).
 * Cache duration: 1 hour.
 *
 * @example
 * ```ts
 * import { getCachedStars, setCachedStars, isCacheValid } from '@/shared/lib/githubStarsCache'
 *
 * // Check cache first
 * const cached = getCachedStars('j4rviscmd', 'bilibili-downloader-gui')
 * if (cached !== null) {
 *   console.log(`Cached stars: ${cached}`)
 * }
 *
 * // Update cache after API call
 * setCachedStars('j4rviscmd', 'bilibili-downloader-gui', 1234)
 * ```
 */

const CACHE_KEY_PREFIX = 'github_stars'
const CACHE_DURATION = 60 * 60 * 1000

export interface StarsCache {
  /** Star count */
  count: number
  /** Unix timestamp in milliseconds when cached */
  timestamp: number
}

/**
 * Retrieves cached star count for a repository.
 *
 * Returns the cached star count if available and not expired.
 * Expired cache entries are automatically removed.
 *
 * @param repoOwner - Repository owner (e.g., "j4rviscmd")
 * @param repoName - Repository name (e.g., "bilibili-downloader-gui")
 * @returns Star count if cached and valid, `null` otherwise
 */
export function getCachedStars(
  repoOwner: string,
  repoName: string,
): number | null {
  const cacheKey = `${CACHE_KEY_PREFIX}_${repoOwner}_${repoName}`
  const cached = localStorage.getItem(cacheKey)

  if (!cached) return null

  try {
    const cache: StarsCache = JSON.parse(cached)
    if (Date.now() - cache.timestamp > CACHE_DURATION) {
      localStorage.removeItem(cacheKey)
      return null
    }
    return cache.count
  } catch {
    localStorage.removeItem(cacheKey)
    return null
  }
}

/**
 * Caches the star count for a repository.
 *
 * Stores the star count with the current timestamp.
 * Existing cache entries are overwritten.
 *
 * @param repoOwner - Repository owner (e.g., "j4rviscmd")
 * @param repoName - Repository name (e.g., "bilibili-downloader-gui")
 * @param count - Star count to cache
 */
export function setCachedStars(
  repoOwner: string,
  repoName: string,
  count: number,
): void {
  const cacheKey = `${CACHE_KEY_PREFIX}_${repoOwner}_${repoName}`
  const cache: StarsCache = { count, timestamp: Date.now() }
  localStorage.setItem(cacheKey, JSON.stringify(cache))
}

/**
 * Checks if the cache entry is valid (exists and not expired).
 *
 * @param repoOwner - Repository owner (e.g., "j4rviscmd")
 * @param repoName - Repository name (e.g., "bilibili-downloader-gui")
 * @returns `true` if cache is valid, `false` otherwise
 */
export function isCacheValid(repoOwner: string, repoName: string): boolean {
  return getCachedStars(repoOwner, repoName) !== null
}

/**
 * Clears the cached star count for a repository.
 *
 * Removes the cache entry from localStorage if it exists.
 *
 * @param repoOwner - Repository owner (e.g., "j4rviscmd")
 * @param repoName - Repository name (e.g., "bilibili-downloader-gui")
 */
export function clearCachedStars(repoOwner: string, repoName: string): void {
  const cacheKey = `${CACHE_KEY_PREFIX}_${repoOwner}_${repoName}`
  localStorage.removeItem(cacheKey)
}
