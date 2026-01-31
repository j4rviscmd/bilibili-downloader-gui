import type {
  HistoryEntry,
  HistoryFilters,
} from '@/features/history/model/historySlice'
import { invoke } from '@tauri-apps/api/core'

/**
 * Retrieves all download history entries from Tauri backend.
 *
 * Invokes 'get_history' Tauri command to fetch persisted history
 * entries from backend storage.
 *
 * @returns A promise resolving to an array of history entries
 * @throws Error if backend command fails
 *
 * @example
 * ```typescript
 * const history = await getHistory()
 * console.log(history.length) // 42
 * ```
 */
export const getHistory = async (): Promise<HistoryEntry[]> => {
  try {
    const res = await invoke<HistoryEntry[]>('get_history')
    return res
  } catch (error) {
    console.error('Failed to get history:', error)
    throw new Error(
      `Failed to retrieve history: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Adds a new entry to download history.
 *
 * Invokes 'add_history_entry' Tauri command to persist a history
 * entry to backend storage.
 *
 * @param entry - The history entry to add
 * @returns A promise that resolves when entry is saved
 * @throws Error if backend fails to save (e.g., invalid data, disk full)
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
export const addHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
  try {
    await invoke<void>('add_history_entry', { entry })
  } catch (error) {
    console.error('Failed to add history entry:', error)
    throw new Error(
      `Failed to add history entry: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Removes a single history entry by ID.
 *
 * Invokes 'remove_history_entry' Tauri command to delete a specific
 * history entry from backend storage.
 *
 * @param id - The unique identifier of the history entry to remove
 * @returns A promise that resolves when entry is removed
 * @throws Error if backend fails to remove (e.g., entry not found)
 *
 * @example
 * ```typescript
 * await removeHistoryEntry('abc123')
 * ```
 */
export const removeHistoryEntry = async (id: string): Promise<void> => {
  try {
    await invoke<void>('remove_history_entry', { id })
  } catch (error) {
    console.error('Failed to remove history entry:', error)
    throw new Error(
      `Failed to remove history entry: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Clears all download history entries.
 *
 * Invokes 'clear_history' Tauri command to remove all history
 * entries from backend storage.
 *
 * @returns A promise that resolves when all entries are cleared
 * @throws Error if backend fails to clear history
 *
 * @example
 * ```typescript
 * await clearHistory()
 * ```
 */
export const clearHistory = async (): Promise<void> => {
  try {
    await invoke<void>('clear_history')
  } catch (error) {
    console.error('Failed to clear history:', error)
    throw new Error(
      `Failed to clear history: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Searches history entries with optional filters.
 *
 * Invokes 'search_history' Tauri command to search through history
 * entries using a query string and optional filters.
 *
 * @param query - Search query string to match against title, URL, or filename
 * @param filters - Optional filters for status and date range
 * @returns A promise resolving to filtered history entries
 * @throws Error if backend command fails
 *
 * @example
 * ```typescript
 * const results = await searchHistory('my video', { status: 'completed' })
 * console.log(results.length) // 5
 * ```
 */
export const searchHistory = async (
  query: string,
  filters?: HistoryFilters,
): Promise<HistoryEntry[]> => {
  try {
    const res = await invoke<HistoryEntry[]>('search_history', {
      query,
      filters,
    })
    return res
  } catch (error) {
    console.error('Failed to search history:', error)
    throw new Error(
      `Failed to search history: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Exports history entries to a file in the specified format.
 *
 * Invokes 'export_history' Tauri command to export history data
 * to a file (JSON or CSV).
 *
 * @param format - Export format ('json' or 'csv')
 * @returns A promise resolving to the exported data string
 * @throws Error if backend fails to export (e.g., invalid format, disk full)
 *
 * @example
 * ```typescript
 * const jsonData = await exportHistory('json')
 * const csvData = await exportHistory('csv')
 * ```
 */
export const exportHistory = async (
  format: 'json' | 'csv',
): Promise<string> => {
  try {
    const res = await invoke<string>('export_history', { format })
    return res
  } catch (error) {
    console.error('Failed to export history:', error)
    throw new Error(
      `Failed to export history: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
