/**
 * A single watch history entry from Bilibili.
 *
 * Represents a video that the user has previously watched,
 * with metadata about the viewing progress and video details.
 */
export type WatchHistoryEntry = {
  /** Video title */
  title: string
  /** Thumbnail cover image URL */
  cover: string
  /** Base64-encoded thumbnail image */
  coverBase64: string
  /** Bilibili video ID (e.g., 'BV1xx411c7XD') */
  bvid: string
  /** Part CID (unique identifier for the specific part) */
  cid: number
  /** Part page number (1-indexed) */
  page: number
  /** Unix timestamp of when the video was viewed */
  viewAt: number
  /** Total video duration in seconds */
  duration: number
  /** Playback progress in seconds */
  progress: number
  /** Original video URL */
  url: string
}

/**
 * Pagination cursor for watch history API.
 *
 * Used for infinite scroll / load more functionality.
 */
export type WatchHistoryCursor = {
  /** View timestamp for pagination offset */
  viewAt: number
  /** Maximum position in history */
  max: number
  /** Whether the end of history has been reached */
  isEnd: boolean
}

/**
 * Redux state for the watch history feature.
 */
export type WatchHistoryState = {
  /** List of watch history entries */
  entries: WatchHistoryEntry[]
  /** Pagination cursor for loading more entries */
  cursor: WatchHistoryCursor | null
  /** Loading state for initial fetch */
  loading: boolean
  /** Loading state for loading more entries */
  loadingMore: boolean
  /** Error message if any */
  error: string | null
  /** Current search query filter */
  searchQuery: string
  /** Date filter option */
  dateFilter: 'all' | 'today' | 'week' | 'month'
}
