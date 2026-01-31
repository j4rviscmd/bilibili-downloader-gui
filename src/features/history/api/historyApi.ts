import type {
  HistoryEntry,
  HistoryFilters,
} from '@/features/history/model/historySlice'
import { invoke } from '@tauri-apps/api/core'

type InvokeError = unknown

function formatError(prefix: string, error: InvokeError): Error {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${prefix}:`, error)
  return new Error(`${prefix}: ${message}`)
}

/**
 * Retrieves all download history entries from Tauri backend.
 *
 * @returns A promise resolving to an array of history entries
 * @throws Error if backend command fails
 */
export const getHistory = async (): Promise<HistoryEntry[]> => {
  try {
    return await invoke<HistoryEntry[]>('get_history')
  } catch (error) {
    throw formatError('Failed to retrieve history', error)
  }
}

/**
 * Adds a new entry to download history.
 *
 * @param entry - The history entry to add
 * @throws Error if backend fails to save
 */
export const addHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
  try {
    await invoke<void>('add_history_entry', { entry })
  } catch (error) {
    throw formatError('Failed to add history entry', error)
  }
}

/**
 * Removes a single history entry by ID.
 *
 * @param id - The unique identifier of the history entry to remove
 * @throws Error if backend fails to remove
 */
export const removeHistoryEntry = async (id: string): Promise<void> => {
  try {
    await invoke<void>('remove_history_entry', { id })
  } catch (error) {
    throw formatError('Failed to remove history entry', error)
  }
}

/**
 * Clears all download history entries.
 *
 * @throws Error if backend fails to clear history
 */
export const clearHistory = async (): Promise<void> => {
  try {
    await invoke<void>('clear_history')
  } catch (error) {
    throw formatError('Failed to clear history', error)
  }
}

/**
 * Searches history entries with optional filters.
 *
 * @param query - Search query string to match against title, URL, or filename
 * @param filters - Optional filters for status and date range
 * @returns A promise resolving to filtered history entries
 * @throws Error if backend command fails
 */
export const searchHistory = async (
  query: string,
  filters?: HistoryFilters,
): Promise<HistoryEntry[]> => {
  try {
    return await invoke<HistoryEntry[]>('search_history', { query, filters })
  } catch (error) {
    throw formatError('Failed to search history', error)
  }
}

/**
 * Exports history entries to a file in the specified format.
 *
 * @param format - Export format ('json' or 'csv')
 * @returns A promise resolving to the exported data string
 * @throws Error if backend fails to export
 */
export const exportHistory = async (
  format: 'json' | 'csv',
): Promise<string> => {
  try {
    return await invoke<string>('export_history', { format })
  } catch (error) {
    throw formatError('Failed to export history', error)
  }
}
