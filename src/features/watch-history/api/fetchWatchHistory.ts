import { invoke } from '@tauri-apps/api/core'
import type { WatchHistoryCursor, WatchHistoryEntry } from '../types'

type WatchHistoryResponse = {
  entries: WatchHistoryEntry[]
  cursor: WatchHistoryCursor
}

/**
 * Fetches watch history entries from Bilibili.
 *
 * Invokes the 'fetch_watch_history' Tauri command to retrieve paginated
 * watch history data. Supports cursor-based pagination for infinite
 * scroll implementations.
 *
 * @param max - Maximum position in history (use 0 for initial fetch)
 * @param viewAt - Unix timestamp for pagination offset (use 0 for initial
 * fetch)
 * @returns A promise resolving to entries array and pagination cursor
 * @throws Error if the request fails or user is not authenticated
 *
 * @example
 * ```typescript
 * // Initial fetch
 * const response = await fetchWatchHistory(0, 0)
 * console.log('Entries:', response.entries.length)
 * console.log('Has more:', !response.cursor.isEnd)
 *
 * // Load more using cursor
 * if (!response.cursor.isEnd) {
 *   const more = await fetchWatchHistory(response.cursor.max,
 * response.cursor.viewAt)
 * }
 * ```
 */
export async function fetchWatchHistory(
  max: number = 0,
  viewAt: number = 0,
): Promise<WatchHistoryResponse> {
  return invoke<WatchHistoryResponse>('fetch_watch_history', {
    max,
    viewAt,
  })
}
