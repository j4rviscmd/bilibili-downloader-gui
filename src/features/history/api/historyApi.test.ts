import type {
  HistoryEntry,
  HistoryFilters,
} from '@/features/history/model/historySlice'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addHistoryEntry,
  clearHistory,
  exportHistory,
  getHistory,
  removeHistoryEntry,
  searchHistory,
} from './historyApi'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>

describe('historyApi', () => {
  const mockEntry: HistoryEntry = {
    id: '1',
    title: 'Test Video',
    url: 'https://example.com/video1',
    filename: 'test_video.mp4',
    outputPath: '/downloads',
    downloadedAt: '2024-01-15T10:30:00Z',
    duration: 120,
    fileSize: 1024000,
    status: 'completed',
  }

  const mockEntry2: HistoryEntry = {
    id: '2',
    title: 'Another Video',
    url: 'https://example.com/video2',
    filename: 'another_video.mp4',
    outputPath: '/downloads',
    downloadedAt: '2024-01-16T14:20:00Z',
    status: 'failed',
    errorMessage: 'Network error',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getHistory', () => {
    it('should call invoke with get_history command', async () => {
      mockInvoke.mockResolvedValue([mockEntry, mockEntry2])

      const result = await getHistory()

      expect(mockInvoke).toHaveBeenCalledWith('get_history')
      expect(result).toEqual([mockEntry, mockEntry2])
    })

    it('should return empty array when no history', async () => {
      mockInvoke.mockResolvedValue([])

      const result = await getHistory()

      expect(result).toEqual([])
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Database error'))

      await expect(getHistory()).rejects.toThrow(
        'Failed to retrieve history: Database error',
      )
    })
  })

  describe('addHistoryEntry', () => {
    it('should call invoke with add_history_entry command and entry', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await addHistoryEntry(mockEntry)

      expect(mockInvoke).toHaveBeenCalledWith('add_history_entry', {
        entry: mockEntry,
      })
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Invalid data'))

      await expect(addHistoryEntry(mockEntry)).rejects.toThrow(
        'Failed to add history entry: Invalid data',
      )
    })
  })

  describe('removeHistoryEntry', () => {
    it('should call invoke with remove_history_entry command and id', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await removeHistoryEntry('1')

      expect(mockInvoke).toHaveBeenCalledWith('remove_history_entry', {
        id: '1',
      })
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Entry not found'))

      await expect(removeHistoryEntry('non-existent')).rejects.toThrow(
        'Failed to remove history entry: Entry not found',
      )
    })
  })

  describe('clearHistory', () => {
    it('should call invoke with clear_history command', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await clearHistory()

      expect(mockInvoke).toHaveBeenCalledWith('clear_history')
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Permission denied'))

      await expect(clearHistory()).rejects.toThrow(
        'Failed to clear history: Permission denied',
      )
    })
  })

  describe('searchHistory', () => {
    it('should call invoke with search_history command and query', async () => {
      mockInvoke.mockResolvedValue([mockEntry])

      const result = await searchHistory('test')

      expect(mockInvoke).toHaveBeenCalledWith('search_history', {
        query: 'test',
        filters: undefined,
      })
      expect(result).toEqual([mockEntry])
    })

    it('should call invoke with filters when provided', async () => {
      mockInvoke.mockResolvedValue([mockEntry])
      const filters: HistoryFilters = {
        status: 'completed',
        dateFrom: '2024-01-01',
      }

      await searchHistory('test', filters)

      expect(mockInvoke).toHaveBeenCalledWith('search_history', {
        query: 'test',
        filters,
      })
    })

    it('should return empty array when no matches', async () => {
      mockInvoke.mockResolvedValue([])

      const result = await searchHistory('nonexistent')

      expect(result).toEqual([])
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Search error'))

      await expect(searchHistory('test')).rejects.toThrow(
        'Failed to search history: Search error',
      )
    })
  })

  describe('exportHistory', () => {
    it('should call invoke with export_history command and format', async () => {
      mockInvoke.mockResolvedValue('/path/to/export.json')

      const result = await exportHistory('json')

      expect(mockInvoke).toHaveBeenCalledWith('export_history', {
        format: 'json',
      })
      expect(result).toBe('/path/to/export.json')
    })

    it('should support csv format', async () => {
      mockInvoke.mockResolvedValue('/path/to/export.csv')

      const result = await exportHistory('csv')

      expect(mockInvoke).toHaveBeenCalledWith('export_history', {
        format: 'csv',
      })
      expect(result).toBe('/path/to/export.csv')
    })

    it('should throw error when invoke fails', async () => {
      mockInvoke.mockRejectedValue(new Error('Invalid format'))

      await expect(exportHistory('csv')).rejects.toThrow(
        'Failed to export history: Invalid format',
      )
    })
  })
})
