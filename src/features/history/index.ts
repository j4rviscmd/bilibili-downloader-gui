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
export {
  clearCache,
  clearExpiredEntries,
  evictOldestEntries,
  fetchThumbnail,
  removeThumbnail,
  setThumbnail,
  setThumbnailError,
  thumbnailSlice,
} from './model/thumbnailSlice'

// Public API: Types
export type {
  CachedThumbnail,
  ThumbnailCacheState,
} from './model/thumbnailSlice'
