import { store } from '@/app/store'
import type { RootState } from '@/app/store'
import type { HistoryEntry, HistoryFilters } from '@/features/history/model/historySlice'
import {
  addEntry,
  clearHistory,
  removeEntry,
  setEntries,
  setError,
  setFilters,
  setLoading,
  setSearchQuery,
} from '@/features/history/model/historySlice'
import {
  addHistoryEntry as apiAddHistoryEntry,
  clearHistory as apiClearHistory,
  exportHistory,
  getHistory,
  removeHistoryEntry as apiRemoveHistoryEntry,
} from '@/features/history/api/historyApi'
import { useEffect, useMemo } from 'react'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'

/**
 * Wraps an async operation with loading state and error handling.
 */
async function withLoading<T>(
  callback: () => Promise<T>,
  onSuccess?: () => void,
): Promise<T> {
  store.dispatch(setLoading(true))
  try {
    const result = await callback()
    store.dispatch(setError(null))
    onSuccess?.()
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unknown error occurred'
    store.dispatch(setError(message))
    toast.error(message)
    throw err
  } finally {
    store.dispatch(setLoading(false))
  }
}

/**
 * Custom hook for managing download history.
 *
 * Provides history entries, search/filter functionality, CRUD operations,
 * export functionality, and loading/error states.
 */
export function useHistory() {
  const entries = useSelector((state: RootState) => state.history.entries)
  const loading = useSelector((state: RootState) => state.history.loading)
  const error = useSelector((state: RootState) => state.history.error)
  const filters = useSelector((state: RootState) => state.history.filters)
  const searchQuery = useSelector((state: RootState) => state.history.searchQuery)

  useEffect(() => {
    withLoading(() => getHistory().then((entries) => store.dispatch(setEntries(entries))))
  }, [])

  const filteredEntries = useMemo(() => {
    let result = entries

    if (filters.status && filters.status !== 'all') {
      result = result.filter((entry) => entry.status === filters.status)
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (entry) =>
          entry.title.toLowerCase().includes(query) ||
          entry.url.toLowerCase().includes(query) ||
          entry.filename?.toLowerCase().includes(query),
      )
    }

    return result
  }, [entries, filters, searchQuery])

  const add = (entry: HistoryEntry) =>
    withLoading(
      () => apiAddHistoryEntry(entry),
      () => {
        store.dispatch(addEntry(entry))
        toast.success('History entry added')
      },
    )

  const remove = (id: string) =>
    withLoading(
      () => apiRemoveHistoryEntry(id),
      () => {
        store.dispatch(removeEntry(id))
        toast.success('Entry removed')
      },
    )

  const clear = () =>
    withLoading(
      () => apiClearHistory(),
      () => {
        store.dispatch(clearHistory())
        toast.success('History cleared')
      },
    )

  const setSearch = (query: string) => {
    store.dispatch(setSearchQuery(query))
  }

  const updateFilters = (newFilters: HistoryFilters) => {
    store.dispatch(setFilters(newFilters))
  }

  const exportData = async (format: 'json' | 'csv'): Promise<string> =>
    withLoading(
      () => exportHistory(format),
      () => toast.success(`History exported as ${format.toUpperCase()}`),
    )

  return {
    entries: filteredEntries,
    loading,
    error,
    filters,
    searchQuery,
    add,
    remove,
    clear,
    setSearch,
    updateFilters,
    exportData,
  }
}
