import { invoke } from '@tauri-apps/api/core'

/** A locally persisted search-keyword entry (`search_history.json`). */
export interface SearchHistoryEntry {
  keyword: string
  searchedAt: string
  useCount: number
}

/**
 * Fetches the local search history (newest first, up to 10 entries).
 *
 * Best-effort: the backend degrades a corrupted store to an empty list.
 */
export async function getSearchHistoryApi(): Promise<SearchHistoryEntry[]> {
  return invoke<SearchHistoryEntry[]>('get_search_history')
}

/** Records a submitted keyword (dedupes + bumps recency on the backend). */
export async function recordSearchApi(keyword: string): Promise<void> {
  return invoke<void>('record_search', { keyword })
}

/** Removes one keyword; resolves to the updated list for panel refresh. */
export async function removeSearchHistoryApi(
  keyword: string,
): Promise<SearchHistoryEntry[]> {
  return invoke<SearchHistoryEntry[]>('remove_search_history_entry', {
    keyword,
  })
}

/** Clears the entire search history. */
export async function clearSearchHistoryApi(): Promise<void> {
  return invoke<void>('clear_search_history')
}
