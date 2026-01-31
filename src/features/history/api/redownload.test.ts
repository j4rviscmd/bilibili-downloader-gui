import type { HistoryEntry } from '@/features/history/model/historySlice'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redownloadFromHistory } from './redownload'

vi.mock('@/features/video/api/fetchVideoInfo', () => ({
  fetchVideoInfo: vi.fn(),
}))
vi.mock('@/features/video/api/downloadVideo', () => ({
  downloadVideo: vi.fn(),
}))

import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import { downloadVideo } from '@/features/video/api/downloadVideo'

const mockFetchVideoInfo = fetchVideoInfo as ReturnType<typeof vi.fn>
const mockDownloadVideo = downloadVideo as ReturnType<typeof vi.fn>

describe('redownloadFromHistory', () => {
  const mockEntry: HistoryEntry = {
    id: '1',
    title: 'Test Video',
    url: 'https://www.bilibili.com/video/BV1xx411c7XD',
    downloadedAt: '2024-01-15T10:30:00Z',
    status: 'completed',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful redownload', () => {
    it('should extract video ID and fetch video info', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1xx411c7XD',
        parts: [
          {
            part: 'Part 1',
            page: 1,
            cid: 123456,
            duration: 120,
            videoQualities: [{ quality: '1080p', id: 80 }],
            audioQualities: [{ quality: '64K', id: 30216 }],
            thumbnail: { url: 'thumb.jpg', base64: 'data' },
          },
        ],
      }
      mockFetchVideoInfo.mockResolvedValue(mockVideo)

      await redownloadFromHistory(mockEntry)

      expect(mockFetchVideoInfo).toHaveBeenCalledWith('BV1xx411c7XD')
    })

    it('should call downloadVideo for each part', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1xx411c7XD',
        parts: [
          {
            part: 'Part 1',
            page: 1,
            cid: 123456,
            duration: 120,
            videoQualities: [{ quality: '1080p', id: 80 }],
            audioQualities: [{ quality: '64K', id: 30216 }],
            thumbnail: { url: 'thumb.jpg', base64: 'data' },
          },
          {
            part: 'Part 2',
            page: 2,
            cid: 234567,
            duration: 180,
            videoQualities: [{ quality: '720p', id: 64 }],
            audioQualities: [{ quality: '64K', id: 30216 }],
            thumbnail: { url: 'thumb2.jpg', base64: 'data2' },
          },
        ],
      }
      mockFetchVideoInfo.mockResolvedValue(mockVideo)

      await redownloadFromHistory(mockEntry)

      expect(mockDownloadVideo).toHaveBeenCalledTimes(2)
      expect(mockDownloadVideo).toHaveBeenNthCalledWith(1, 'BV1xx411c7XD', 123456, 'Test Video Part 1', 80, 30216, expect.anything(), expect.anything())
      expect(mockDownloadVideo).toHaveBeenNthCalledWith(2, 'BV1xx411c7XD', 234567, 'Test Video Part 2', 64, 30216, expect.anything(), expect.anything())
    })

    it('should use first available quality for each part', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1xx411c7XD',
        parts: [
          {
            part: 'Part 1',
            page: 1,
            cid: 123456,
            duration: 120,
            videoQualities: [
              { quality: '1080p', id: 80 },
              { quality: '720p', id: 64 },
            ],
            audioQualities: [
              { quality: 'Hi-Res', id: 30251 },
              { quality: '64K', id: 30216 },
            ],
            thumbnail: { url: 'thumb.jpg', base64: 'data' },
          },
        ],
      }
      mockFetchVideoInfo.mockResolvedValue(mockVideo)

      await redownloadFromHistory(mockEntry)

      expect(mockDownloadVideo).toHaveBeenCalledWith('BV1xx411c7XD', 123456, 'Test Video Part 1', 80, 30251, expect.anything(), expect.anything())
    })

    it('should skip parts with cid=0', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1xx411c7XD',
        parts: [
          {
            part: 'Part 1',
            page: 1,
            cid: 0,
            duration: 120,
            videoQualities: [{ quality: '1080p', id: 80 }],
            audioQualities: [{ quality: '64K', id: 30216 }],
            thumbnail: { url: 'thumb.jpg', base64: 'data' },
          },
          {
            part: 'Part 2',
            page: 2,
            cid: 234567,
            duration: 180,
            videoQualities: [{ quality: '720p', id: 64 }],
            audioQualities: [{ quality: '64K', id: 30216 }],
            thumbnail: { url: 'thumb2.jpg', base64: 'data2' },
          },
        ],
      }
      mockFetchVideoInfo.mockResolvedValue(mockVideo)

      await redownloadFromHistory(mockEntry)

      expect(mockDownloadVideo).toHaveBeenCalledTimes(1)
      expect(mockDownloadVideo).toHaveBeenCalledWith(
        'BV1xx411c7XD',
        234567,
        expect.any(String),
        expect.any(Number),
        expect.any(String),
        expect.any(String),
      )
    })
  })

  describe('error handling', () => {
    it('should throw error for invalid URL', async () => {
      const invalidEntry: HistoryEntry = {
        id: '1',
        title: 'Test Video',
        url: 'https://example.com/invalid',
        downloadedAt: '2024-01-15T10:30:00Z',
        status: 'completed',
      }

      await expect(redownloadFromHistory(invalidEntry)).rejects.toThrow('Invalid Bilibili URL')
      expect(mockFetchVideoInfo).not.toHaveBeenCalled()
      expect(mockDownloadVideo).not.toHaveBeenCalled()
    })

    it('should throw error when video not found', async () => {
      mockFetchVideoInfo.mockResolvedValue(null)

      await expect(redownloadFromHistory(mockEntry)).rejects.toThrow('Video not found or no parts available')
      expect(mockDownloadVideo).not.toHaveBeenCalled()
    })

    it('should throw error when video has no parts', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1xx411c7XD',
        parts: [],
      }
      mockFetchVideoInfo.mockResolvedValue(mockVideo)

      await expect(redownloadFromHistory(mockEntry)).rejects.toThrow('Video not found or no parts available')
      expect(mockDownloadVideo).not.toHaveBeenCalled()
    })
  })
})
