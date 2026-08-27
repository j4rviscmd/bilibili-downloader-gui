import type {
  WatchHistoryCursor,
  WatchHistoryEntry,
} from '@/features/watch-history/types'
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWatchHistory } from './fetchWatchHistory'

const mockEntry: WatchHistoryEntry = {
  title: 'Watched video',
  cover: 'https://cover.img',
  bvid: 'BV1xx411c7XD',
  cid: 123456,
  page: 1,
  viewAt: 1700000000,
  duration: 300,
  progress: 120,
  url: 'https://www.bilibili.com/video/BV1xx411c7XD',
}

const mockCursor: WatchHistoryCursor = {
  viewAt: 1700000000,
  max: 25,
  isEnd: false,
}

describe('fetchWatchHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with fetch_watch_history command and default pagination', async () => {
    mockInvoke.mockResolvedValue({ entries: [mockEntry], cursor: mockCursor })

    const result = await fetchWatchHistory()

    expect(mockInvoke).toHaveBeenCalledWith('fetch_watch_history', {
      max: 0,
      viewAt: 0,
    })
    expect(result).toEqual({ entries: [mockEntry], cursor: mockCursor })
  })

  it('should pass cursor values through for pagination', async () => {
    mockInvoke.mockResolvedValue({ entries: [], cursor: null })

    await fetchWatchHistory(25, 1700000000)

    expect(mockInvoke).toHaveBeenCalledWith('fetch_watch_history', {
      max: 25,
      viewAt: 1700000000,
    })
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

    await expect(fetchWatchHistory(0, 0)).rejects.toBe('ERR::UNAUTHORIZED')
  })
})
