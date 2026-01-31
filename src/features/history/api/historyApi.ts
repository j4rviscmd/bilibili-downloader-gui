import type { HistoryFilters, HistoryItem } from '@/features/history/model/historySlice'
import { invoke } from '@tauri-apps/api/core'

/**
 * Retrieves all download history entries from the Tauri backend.
 *
 * Invokes the 'get_history' Tauri command to fetch persisted history
 * entries from the backend storage.
 *
 * @returns A promise resolving to an array of history entries
 *
 * @example
 * ```typescript
 * const history = await getHistory()
 * console.log(history.length) // 42
 * ```
 */
export const getHistory = async () => {
  const res = await invoke<HistoryItem[]>('get_history')

  return res
}

/**
 * Adds a new entry to the download history.
 *
 * Invokes the 'add_history_entry' Tauri command to persist a history
 * entry to the backend storage.
 *
 * @param entry - The history entry to add
 * @returns A promise that resolves when the entry is saved
 * @throws Error if the backend fails to save (e.g., invalid data, disk full)
 *
 * @example
 * ```typescript
 * await addHistoryEntry({
 *   id: 'abc123',
 *   title: 'My Video',
 *   url: 'https://bilibili.com/video/BV1xx',
 *   filename: 'my_video.mp4',
 *   outputPath: '/downloads',
 *   downloadedAt: '2024-01-15T10:30:00Z',
 *   status: 'completed'
 * })
 * ```
 */
export const addHistoryEntry = async (entry: HistoryItem) => {
  const res = await invoke('add_history_entry', { entry })

  return res
}

/**
 * Removes a single history entry by ID.
 *
 * Invokes the 'remove_history_entry' Tauri command to delete a specific
 * history entry from the backend storage.
 *
 * @param id - The unique identifier of the history entry to remove
 * @returns A promise that resolves when the entry is removed
 * @throws Error if the backend fails to remove (e.g., entry not found)
 *
 * @example
 * ```typescript
 * await removeHistoryEntry('abc123')
 * ```
 */
export const removeHistoryEntry = async (id: string) => {
  const res = await invoke('remove_history_entry', { id })

  return res
}

/**
 * Clears all download history entries.
 *
 * Invokes the 'clear_history' Tauri command to remove all history
 * entries from the backend storage.
 *
 * @returns A promise that resolves when all entries are cleared
 * @throws Error if the backend fails to clear history
 *
 * @example
 * ```typescript
 * await clearHistory()
 * ```
 */
export const clearHistory = async () => {
  const res = await invoke('clear_history')

  return res
}

/**
 * Searches history entries with optional filters.
 *
 * Invokes the 'search_history' Tauri command to search through history
 * entries using a query string and optional filters.
 *
 * @param query - Search query string to match against title, URL, or filename
 * @param filters - Optional filters for status and date range
 * @returns A promise resolving to filtered history entries
 *
 * @example
 * ```typescript
 * const results = await searchHistory('my video', { status: 'completed' })
 * console.log(results.length) // 5
 * ```
 */
export const searchHistory = async (query: string, filters?: HistoryFilters) => {
  const res = await invoke<HistoryItem[]>('search_history', { query, filters })

  return res
}

/**
 * Exports history entries to a file in the specified format.
 *
 * Invokes the 'export_history' Tauri command to export history data
 * to a file (JSON, CSV, etc.).
 *
 * @param format - Export format ('json', 'csv', etc.)
 * @returns A promise resolving to the exported file path
 * @throws Error if the backend fails to export (e.g., invalid format, disk full)
 *
 * @example
 * ```typescript
 * const filePath = await exportHistory('json')
 * console.log(filePath) // '/path/to/export.json'
 * ```
 */
export const exportHistory = async (format: string) => {
  const res = await invoke<string>('export_history', { format })

  return res
}
