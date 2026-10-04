import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches keyword suggestions for a partial search input via the
 * `search_suggest` command.
 *
 * Best-effort by design: the backend degrades failures to an empty list, so
 * typing never surfaces an error.
 *
 * @param keyword - Partial input (non-empty; caller trims)
 * @returns Up to 10 suggested keywords
 */
export async function searchSuggestApi(keyword: string): Promise<string[]> {
  return invoke<string[]>('search_suggest', { keyword })
}
