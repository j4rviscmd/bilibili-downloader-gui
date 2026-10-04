/** Sort orders of the keyword video search (`order` param of the bilibili
 * search API; `totalrank` is the API default) — single source for the
 * `VideoSearchOrder` type and the filter-bar options. */
export const VIDEO_SEARCH_ORDERS = [
  'totalrank',
  'click',
  'pubdate',
  'dm',
  'stow',
] as const
export type VideoSearchOrder = (typeof VIDEO_SEARCH_ORDERS)[number]

/** Filter state of the video search page. Mirrors the backend
 * `SearchFilters` DTO; values are the raw bilibili API param values. */
export interface VideoSearchFilters {
  order: VideoSearchOrder
  /** Duration bucket: 0 all, 1 <10min, 2 10-30min, 3 30-60min, 4 >60min. */
  duration: number
  /** Zone (分区) tid; 0 = all zones. */
  tids: number
}

/** bilibili defaults (totalrank / all durations / all zones). */
export const DEFAULT_VIDEO_SEARCH_FILTERS: VideoSearchFilters = {
  order: 'totalrank',
  duration: 0,
  tids: 0,
}

/** One video result from the backend `search_videos` command. */
export interface VideoSearchEntry {
  bvid: string
  /** Title with highlight tags already stripped by the backend. */
  title: string
  /** Cover URL (https). */
  cover: string
  author: string
  play: number
  /** Duration in seconds. */
  duration: number
  /** Zone (分区) id as sent by the API (numeric string, e.g. "193"). */
  typeid: string
  /** Zone display name in the source language; fallback when the tid is
   * not in the known-zones map. */
  typename: string
}

/**
 * Wire shape of the `search_videos` response (camelCase, like watch history
 * DTOs).
 */
export interface VideoSearchResponse {
  page: number
  numResults: number
  numPages: number
  entries: VideoSearchEntry[]
}

/** Redux state of the video search feature. */
export interface VideoSearchState {
  /** Last submitted (searched) keyword. */
  keyword: string
  page: number
  /** Filters persist across keyword changes (bilibili behavior). */
  filters: VideoSearchFilters
  results: VideoSearchResponse | null
  loading: boolean
  error: string | null
}
