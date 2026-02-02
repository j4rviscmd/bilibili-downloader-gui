/**
 * History feature module.
 *
 * Provides video download history management and thumbnail caching.
 *
 * @module history
 */

// Public API: Components
export { default as HistoryItem } from './ui/HistoryItem'

// Public API: Hooks
export { useThumbnailCache } from './hooks/useThumbnailCache'

// Public API: Redux Slice
export { thumbnailSlice } from './model/thumbnailSlice'
export {
  fetchThumbnail,
  setThumbnail,
  setThumbnailError,
  removeThumbnail,
  clearExpiredEntries,
  clearCache,
  evictOldestEntries,
} from './model/thumbnailSlice'

// Public API: Types
export type { CachedThumbnail, ThumbnailCacheState } from './model/thumbnailSlice'
