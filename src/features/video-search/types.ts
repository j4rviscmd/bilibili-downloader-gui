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
  results: VideoSearchResponse | null
  loading: boolean
  error: string | null
}
