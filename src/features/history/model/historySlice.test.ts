import type {
  HistoryEntry,
  HistoryFilters,
} from '@/features/history/model/historySlice'
import historyReducer, {
  addEntry,
  clearHistory,
  removeEntry,
  setEntries,
  setError,
  setFilters,
  setLoading,
  setSearchQuery,
} from '@/features/history/model/historySlice'
import { describe, expect, it } from 'vitest'

describe('historySlice', () => {
  const mockEntry1: HistoryEntry = {
    id: '1',
    title: 'Test Video',
    url: 'https://example.com/video1',
    filename: 'test_video.mp4',
    downloadedAt: '2024-01-15T10:30:00Z',
    status: 'completed',
  }

  const mockEntry2: HistoryEntry = {
    id: '2',
    title: 'Another Video',
    url: 'https://example.com/video2',
    filename: 'another_video.mp4',
    downloadedAt: '2024-01-16T14:20:00Z',
    status: 'failed',
    errorMessage: 'Network error',
  }

  const initialState = {
    entries: [],
    loading: false,
    error: null,
    filters: {},
    searchQuery: '',
  }

  it('should return initial state', () => {
    const state = historyReducer(undefined, { type: 'unknown' })

    expect(state).toEqual(initialState)
  })

  describe('setEntries', () => {
    it('should replace all entries', () => {
      const state = historyReducer(
        initialState,
        setEntries([mockEntry1, mockEntry2]),
      )

      expect(state.entries).toEqual([mockEntry1, mockEntry2])
    })

    it('should overwrite existing entries', () => {
      const state = historyReducer(
        { ...initialState, entries: [mockEntry1] },
        setEntries([mockEntry2]),
      )

      expect(state.entries).toEqual([mockEntry2])
    })
  })

  describe('addEntry', () => {
    it('should add entry to beginning of array', () => {
      const state = historyReducer(initialState, addEntry(mockEntry1))

      expect(state.entries).toEqual([mockEntry1])
    })

    it('should prepend new entry to existing entries', () => {
      const state = historyReducer(
        { ...initialState, entries: [mockEntry1] },
        addEntry(mockEntry2),
      )

      expect(state.entries).toEqual([mockEntry2, mockEntry1])
    })
  })

  describe('removeEntry', () => {
    it('should remove entry by ID', () => {
      const state = historyReducer(
        { ...initialState, entries: [mockEntry1, mockEntry2] },
        removeEntry('1'),
      )

      expect(state.entries).toEqual([mockEntry2])
    })

    it('should do nothing if ID not found', () => {
      const state = historyReducer(
        { ...initialState, entries: [mockEntry1, mockEntry2] },
        removeEntry('non-existent'),
      )

      expect(state.entries).toEqual([mockEntry1, mockEntry2])
    })
  })

  describe('clearHistory', () => {
    it('should clear all entries', () => {
      const state = historyReducer(
        { ...initialState, entries: [mockEntry1, mockEntry2] },
        clearHistory(),
      )

      expect(state.entries).toEqual([])
    })
  })

  describe('setFilters', () => {
    it('should update filters', () => {
      const filters: HistoryFilters = { status: 'completed' }
      const state = historyReducer(initialState, setFilters(filters))

      expect(state.filters).toEqual(filters)
    })

    it('should update date filter when provided', () => {
      const filters: HistoryFilters = {
        status: 'completed',
        dateFrom: '2024-01-01',
      }
      const state = historyReducer(initialState, setFilters(filters))

      expect(state.filters).toEqual(filters)
    })
  })

  describe('setSearchQuery', () => {
    it('should update search query', () => {
      const state = historyReducer(initialState, setSearchQuery('test query'))

      expect(state.searchQuery).toBe('test query')
    })

    it('should allow empty query', () => {
      const state = historyReducer(
        { ...initialState, searchQuery: 'old query' },
        setSearchQuery(''),
      )

      expect(state.searchQuery).toBe('')
    })
  })

  describe('setLoading', () => {
    it('should set loading to true', () => {
      const state = historyReducer(initialState, setLoading(true))

      expect(state.loading).toBe(true)
    })

    it('should set loading to false', () => {
      const state = historyReducer(
        { ...initialState, loading: true },
        setLoading(false),
      )

      expect(state.loading).toBe(false)
    })
  })

  describe('setError', () => {
    it('should set error message', () => {
      const state = historyReducer(
        initialState,
        setError('Something went wrong'),
      )

      expect(state.error).toBe('Something went wrong')
    })

    it('should clear error when null', () => {
      const state = historyReducer(
        { ...initialState, error: 'Previous error' },
        setError(null),
      )

      expect(state.error).toBe(null)
    })
  })
})
