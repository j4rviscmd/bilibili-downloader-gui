/**
 * useHistory suite.
 *
 * Covers the mount-time get_history load, client-side filtering/searching,
 * CRUD operations (asserting invoke command + args), export, and the
 * withLoading error path (error slice + toast).
 */

import { store } from '@/app/store'
import { useHistory } from '@/features/history/hooks/useHistory'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import {
  clearHistory,
  setEntries,
  setError,
  setFilters,
  setLoading,
  setSearchQuery,
} from '@/features/history/model/historySlice'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock

const entryCompleted: HistoryEntry = {
  id: 'a',
  title: 'Alpha Video',
  url: 'https://b23.tv/alpha',
  filename: 'alpha.mp4',
  downloadedAt: '2026-01-01T00:00:00Z',
  status: 'completed',
}

const entryFailed: HistoryEntry = {
  id: 'b',
  title: 'Beta video',
  url: 'https://b23.tv/beta',
  downloadedAt: '2026-01-02T00:00:00Z',
  status: 'failed',
  errorMessage: 'boom',
}

const entryNew: HistoryEntry = {
  id: 'c',
  title: 'Gamma',
  url: 'https://b23.tv/gamma',
  downloadedAt: '2026-01-03T00:00:00Z',
  status: 'completed',
}

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    // Default get_history to [] so the mount effect never dispatches
    // setEntries(undefined) when a test only mocks its own command.
    const handler = handlers[cmd] ?? (cmd === 'get_history' ? [] : undefined)
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

describe('useHistory', () => {
  beforeEach(() => {
    store.dispatch(clearHistory())
    store.dispatch(setEntries([]))
    store.dispatch(setFilters({}))
    store.dispatch(setSearchQuery(''))
    store.dispatch(setError(null))
    store.dispatch(setLoading(false))
    vi.clearAllMocks()
    // Default: mount effect's get_history resolves to an empty list.
    mockCommands({ get_history: [] })
  })

  it('loads entries from the backend on mount', async () => {
    mockCommands({ get_history: [entryCompleted, entryFailed] })
    const { result } = renderHookWithStore(() => useHistory())

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2)
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_history', {})
    expect(store.getState().history.loading).toBe(false)
  })

  it('refresh() re-reads entries from the backend (parallel instance wrote new ones)', async () => {
    // Mount with one entry, then simulate another app instance's download
    // appearing on disk: the next get_history returns both (issue #560).
    mockCommands({ get_history: [entryCompleted] })
    const { result } = renderHookWithStore(() => useHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    mockCommands({ get_history: [entryNew, entryCompleted] })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.entries).toEqual([entryNew, entryCompleted])
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_history', {})
  })

  it('filters by status', async () => {
    mockCommands({ get_history: [entryCompleted, entryFailed] })
    const { result } = renderHookWithStore(() => useHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))

    act(() => result.current.updateFilters({ status: 'failed' }))
    await waitFor(() => {
      expect(result.current.entries).toEqual([entryFailed])
    })

    act(() => result.current.updateFilters({ status: 'all' }))
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2)
    })
  })

  it('searches title, url, and filename case-insensitively', async () => {
    mockCommands({ get_history: [entryCompleted, entryFailed] })
    const { result } = renderHookWithStore(() => useHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))

    act(() => result.current.setSearch('ALPHA'))
    await waitFor(() => {
      expect(result.current.entries).toEqual([entryCompleted])
    })

    act(() => result.current.setSearch('B23.TV/BETA'))
    await waitFor(() => {
      expect(result.current.entries).toEqual([entryFailed])
    })

    act(() => result.current.setSearch('alpha.mp4'))
    await waitFor(() => {
      expect(result.current.entries).toEqual([entryCompleted])
    })

    act(() => result.current.setSearch('no-such-video'))
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(0)
    })
  })

  it('adds an entry via add_history_entry, unshifts it, and toasts', async () => {
    mockCommands({ add_history_entry: undefined })
    const { result } = renderHookWithStore(() => useHistory())

    await act(async () => {
      await result.current.add(entryNew)
    })

    expect(mockInvoke).toHaveBeenCalledWith('add_history_entry', {
      entry: entryNew,
    })
    expect(result.current.entries[0]!.id).toBe('c')
    expect(toastSuccess).toHaveBeenCalledWith('history.entryAdded')
  })

  it('sets the error slice and toasts when add fails', async () => {
    mockCommands({
      get_history: [entryCompleted],
      add_history_entry: new Error('disk full'),
    })
    const { result } = renderHookWithStore(() => useHistory())
    // Let the mount load settle first: its success path resets the error.
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    await act(async () => {
      await expect(result.current.add(entryNew)).rejects.toThrow(
        'Failed to add history entry: disk full',
      )
    })

    expect(result.current.error).toBe('Failed to add history entry: disk full')
    expect(toastError).toHaveBeenCalledWith(
      'Failed to add history entry: disk full',
    )
    expect(result.current.loading).toBe(false)
  })

  it('removes an entry via remove_history_entry', async () => {
    mockCommands({
      get_history: [entryCompleted, entryFailed],
      remove_history_entry: undefined,
    })
    const { result } = renderHookWithStore(() => useHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))

    await act(async () => {
      await result.current.remove('a')
    })

    expect(mockInvoke).toHaveBeenCalledWith('remove_history_entry', { id: 'a' })
    expect(result.current.entries.map((e) => e.id)).toEqual(['b'])
    expect(toastSuccess).toHaveBeenCalledWith('history.entryRemoved')
  })

  it('clears all entries via clear_history', async () => {
    mockCommands({
      get_history: [entryCompleted],
      clear_history: undefined,
    })
    const { result } = renderHookWithStore(() => useHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    await act(async () => {
      await result.current.clear()
    })

    expect(mockInvoke).toHaveBeenCalledWith('clear_history', {})
    expect(result.current.entries).toHaveLength(0)
    expect(toastSuccess).toHaveBeenCalledWith('history.cleared')
  })

  it('exports as json and csv with the matching toast', async () => {
    mockCommands({ export_history: '/out/history.json' })
    const { result } = renderHookWithStore(() => useHistory())

    let jsonPath = ''
    await act(async () => {
      jsonPath = await result.current.exportData('json')
    })

    expect(jsonPath).toBe('/out/history.json')
    expect(mockInvoke).toHaveBeenCalledWith('export_history', {
      format: 'json',
    })
    expect(toastSuccess).toHaveBeenCalledWith('history.exportedAsJson')

    mockCommands({ export_history: '/out/history.csv' })
    await act(async () => {
      await result.current.exportData('csv')
    })

    expect(mockInvoke).toHaveBeenCalledWith('export_history', { format: 'csv' })
    expect(toastSuccess).toHaveBeenCalledWith('history.exportedAsCsv')
  })
})
