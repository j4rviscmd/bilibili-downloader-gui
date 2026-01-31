import * as historyApi from '@/features/history/api/historyApi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>

describe('History Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('History CRUD Operations', () => {
    it('should get history entries', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Test Video 1',
          url: 'https://bilibili.com/video/BV1xx411c7XD',
          downloadedAt: '2024-01-15T10:30:00Z',
          status: 'completed',
        },
        {
          id: '2',
          title: 'Test Video 2',
          url: 'https://bilibili.com/video/BV1xx411c7XE',
          downloadedAt: '2024-01-16T14:20:00Z',
          status: 'completed',
        },
      ]
      mockInvoke.mockResolvedValue(mockEntries)

      const result = await historyApi.getHistory()

      expect(mockInvoke).toHaveBeenCalledWith('get_history', {})
      expect(result).toEqual(mockEntries)
    })

    it('should handle empty history', async () => {
      mockInvoke.mockResolvedValue([])

      const result = await historyApi.getHistory()

      expect(result).toEqual([])
    })
  })

  describe('History Search and Filter', () => {
    it('should search history entries', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Search Match Video',
          url: 'https://bilibili.com/video/BV1xx411c7XD',
          downloadedAt: '2024-01-15T10:30:00Z',
          status: 'completed',
        },
        {
          id: '2',
          title: 'No Match Video',
          url: 'https://bilibili.com/video/BV1xx411c7XE',
          downloadedAt: '2024-01-16T14:20:00Z',
          status: 'completed',
        },
      ]
      mockInvoke.mockResolvedValue(mockEntries)

      const result = await historyApi.searchHistory('Match')

      expect(mockInvoke).toHaveBeenCalledWith('search_history', {
        query: 'Match',
        filters: undefined,
      })
      // Frontend handles filtering, so backend returns all entries
      expect(result).toEqual(mockEntries)
    })

    it('should filter by status', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Completed Video',
          url: 'https://bilibili.com/video/BV1xx411c7XD',
          downloadedAt: '2024-01-15T10:30:00Z',
          status: 'completed',
        },
        {
          id: '2',
          title: 'Failed Video',
          url: 'https://bilibili.com/video/BV1xx411c7XE',
          downloadedAt: '2024-01-16T14:20:00Z',
          status: 'failed',
        },
      ]
      mockInvoke.mockResolvedValue(mockEntries)

      const result = await historyApi.searchHistory('Video', {
        status: 'completed',
      })

      expect(mockInvoke).toHaveBeenCalledWith('search_history', {
        query: 'Video',
        filters: { status: 'completed' },
      })
      // Frontend handles filtering, so backend returns all entries
      expect(result).toEqual(mockEntries)
    })
  })

  describe('History Export', () => {
    it('should export history to JSON', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Test Video',
          url: 'https://bilibili.com/video/BV1xx411c7XD',
          downloadedAt: '2024-01-15T10:30:00Z',
          status: 'completed',
        },
      ]
      const mockJsonData = '[{"id":"1","title":"Test Video"}]'
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_history') return Promise.resolve(mockEntries)
        if (cmd === 'export_history') return Promise.resolve(mockJsonData)
        return Promise.resolve(undefined)
      })

      const result = await historyApi.exportHistory('json')

      expect(mockInvoke).toHaveBeenCalledWith('export_history', {
        format: 'json',
      })
      expect(result).toEqual(mockJsonData)
    })

    it('should export history to CSV', async () => {
      const mockEntries = [
        {
          id: '1',
          title: 'Test Video',
          url: 'https://bilibili.com/video/BV1xx411c7XD',
          downloadedAt: '2024-01-15T10:30:00Z',
          status: 'completed',
        },
      ]
      const mockCsvData =
        'id,title,url,filename,downloadedAt,status\n1,Test Video,https://bilibili.com/video/BV1xx411c7XD,,2024-01-15T10:30:00Z,completed'
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_history') return Promise.resolve(mockEntries)
        if (cmd === 'export_history') return Promise.resolve(mockCsvData)
        return Promise.resolve(undefined)
      })

      const result = await historyApi.exportHistory('csv')

      expect(mockInvoke).toHaveBeenCalledWith('export_history', {
        format: 'csv',
      })
      expect(result).toEqual(mockCsvData)
    })
  })
})
