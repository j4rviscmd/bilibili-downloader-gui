import { invoke } from '@tauri-apps/api/core'

/**
 * A bilibili hot-search (trending) keyword.
 *
 * `keyword` is the value to search; `showName` is the display string
 * (falls back to the keyword when the API omits it).
 */
export interface TrendingKeyword {
  keyword: string
  showName: string
}

/**
 * Fetches the bilibili trending keyword list (up to 10).
 *
 * Best-effort: the backend degrades transport/API failures to an empty
 * list, so the panel simply hides its trending section on failure.
 */
export async function searchTrendingApi(): Promise<TrendingKeyword[]> {
  return invoke<TrendingKeyword[]>('search_trending')
}
