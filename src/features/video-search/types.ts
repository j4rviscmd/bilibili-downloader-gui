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

/**
 * One keyword's accumulated feed — kept per keyword so switching between
 * searched keywords (history back/forward) restores the loaded pages and
 * scroll depth without refetching.
 */
export interface VideoSearchFeed {
  /** Filters the feed was loaded under (restored together with it). */
  filters: VideoSearchFilters
  /** Cards accumulated across loaded pages (deduped by bvid). */
  entries: VideoSearchEntry[]
  /** Last loaded page. */
  page: number
  numPages: number
  numResults: number
}

/** Redux state of the video search feature. */
export interface VideoSearchState {
  /** Last submitted (searched) keyword. */
  keyword: string
  page: number
  /** Active filters. Persist toward never-visited keywords (bilibili
   * behavior); restoring a visited keyword brings back ITS filters with
   * its feed, keeping the bar consistent with the shown cards. */
  filters: VideoSearchFilters
  results: VideoSearchResponse | null
  /** Result cards accumulated across pages (infinite scroll), deduped
   * by bvid. Every page-1 fetch (new keyword, filter change) resets it. */
  entries: VideoSearchEntry[]
  loading: boolean
  error: string | null
  /** Session response cache per searchCacheKey — back/forward and
   * revisited page/filter combos skip the API call (rate-control
   * mitigation; see videoSearchSlice). */
  cache: Record<string, VideoSearchResponse>
  /** Accumulated feed per keyword (the "stack"): the active feed mirrors
   * into keyword/page/filters/results/entries above; visited keywords'
   * feeds stay here so switching back restores them instantly. */
  feeds: Record<string, VideoSearchFeed>
  /** Recency order of `feeds` keys (eviction source of truth — storeFeed
   * re-inserts a keyword on every store/restore, so the first slot is the
   * least-recently-stored; JS objects sort integer-like keywords
   * numerically, breaking Object.keys ordering — see storeFeed). */
  feedOrder: string[]
}
