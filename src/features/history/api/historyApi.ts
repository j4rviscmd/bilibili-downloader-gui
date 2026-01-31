import type {
  HistoryEntry,
  HistoryFilters,
} from '@/features/history/model/historySlice'
import { invoke } from '@tauri-apps/api/core'

/**
 * Formats an error from Tauri invoke call with consistent prefix.
 */
function formatError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${prefix}:`, error)
  return new Error(`${prefix}: ${message}`)
}

/**
 * Wrapper for Tauri invoke calls with consistent error handling.
 */
async function invokeWithErrorHandling<T>(
  command: string,
  args: Record<string, unknown>,
  errorPrefix: string,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw formatError(errorPrefix, error)
  }
}

/**
 * Retrieves all download history entries from Tauri backend.
 */
export const getHistory = (): Promise<HistoryEntry[]> =>
  invokeWithErrorHandling('get_history', {}, 'Failed to retrieve history')

/**
 * Adds a new entry to download history.
 */
export const addHistoryEntry = (entry: HistoryEntry): Promise<void> =>
  invokeWithErrorHandling(
    'add_history_entry',
    { entry },
    'Failed to add history entry',
  )

/**
 * Removes a single history entry by ID.
 */
export const removeHistoryEntry = (id: string): Promise<void> =>
  invokeWithErrorHandling(
    'remove_history_entry',
    { id },
    'Failed to remove history entry',
  )

/**
 * Clears all download history entries.
 */
export const clearHistory = (): Promise<void> =>
  invokeWithErrorHandling('clear_history', {}, 'Failed to clear history')

/**
 * Searches history entries with optional filters.
 */
export const searchHistory = (
  query: string,
  filters?: HistoryFilters,
): Promise<HistoryEntry[]> =>
  invokeWithErrorHandling(
    'search_history',
    { query, filters },
    'Failed to search history',
  )

/**
 * Exports history entries to a file in the specified format.
 */
export const exportHistory = (format: 'json' | 'csv'): Promise<string> =>
  invokeWithErrorHandling(
    'export_history',
    { format },
    'Failed to export history',
  )
