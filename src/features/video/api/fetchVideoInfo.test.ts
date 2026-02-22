import type { SubtitleInfo, VideoQuality, AudioQuality } from '@/features/video/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSubtitlesForPart, fetchPartQualities, fetchVideoInfo } from './fetchVideoInfo'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>

describe('fetchVideoInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchVideoInfo', () => {
    it('should call invoke with fetch_video_info command', async () => {
      const mockVideo = {
        title: 'Test Video',
        bvid: 'BV1234567890',
        parts: [],
        isLimitedQuality: false,
      }
      mockInvoke.mockResolvedValue(mockVideo)

      const result = await fetchVideoInfo('BV1234567890')

      expect(mockInvoke).toHaveBeenCalledWith('fetch_video_info', {
        videoId: 'BV1234567890',
      })
      expect(result).toEqual(mockVideo)
    })

    it('should propagate errors from backend', async () => {
      mockInvoke.mockRejectedValue(new Error('Video not found'))

      await expect(fetchVideoInfo('invalid')).rejects.toThrow('Video not found')
    })
  })

  describe('fetchSubtitlesForPart', () => {
    it('should call invoke with fetch_subtitles_for_part command', async () => {
      const mockSubtitles: SubtitleInfo[] = [
        {
          lan: 'zh-CN',
          lanDoc: '中文（简体）',
          subtitleUrl: 'https://example.com/zh.json',
          isAi: false,
        },
        {
          lan: 'en',
          lanDoc: 'English',
          subtitleUrl: 'https://example.com/en.json',
          isAi: true,
        },
      ]
      mockInvoke.mockResolvedValue(mockSubtitles)

      const result = await fetchSubtitlesForPart('BV1234567890', 123456)

      expect(mockInvoke).toHaveBeenCalledWith('fetch_subtitles_for_part', {
        bvid: 'BV1234567890',
        cid: 123456,
      })
      expect(result).toEqual(mockSubtitles)
    })

    it('should return empty array when no subtitles available', async () => {
      mockInvoke.mockResolvedValue([])

      const result = await fetchSubtitlesForPart('BV1234567890', 123456)

      expect(result).toEqual([])
    })

    it('should propagate errors from backend', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed to fetch subtitles'))

      await expect(fetchSubtitlesForPart('BV1234567890', 123456)).rejects.toThrow(
        'Failed to fetch subtitles',
      )
    })
  })

  describe('fetchPartQualities', () => {
    it('should call invoke with fetch_part_qualities command', async () => {
      const mockVideoQualities: VideoQuality[] = [
        { quality: '1080p', id: 80 },
        { quality: '720p', id: 64 },
      ]
      const mockAudioQualities: AudioQuality[] = [
        { quality: '64K', id: 30216 },
        { quality: '128K', id: 30232 },
      ]
      mockInvoke.mockResolvedValue([mockVideoQualities, mockAudioQualities])

      const [vq, aq] = await fetchPartQualities('BV1234567890', 123456)

      expect(mockInvoke).toHaveBeenCalledWith('fetch_part_qualities', {
        bvid: 'BV1234567890',
        cid: 123456,
      })
      expect(vq).toEqual(mockVideoQualities)
      expect(aq).toEqual(mockAudioQualities)
    })

    it('should return empty arrays when no qualities available', async () => {
      mockInvoke.mockResolvedValue([[], []])

      const [vq, aq] = await fetchPartQualities('BV1234567890', 123456)

      expect(vq).toEqual([])
      expect(aq).toEqual([])
    })

    it('should propagate errors from backend', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed to fetch qualities'))

      await expect(fetchPartQualities('BV1234567890', 123456)).rejects.toThrow(
        'Failed to fetch qualities',
      )
    })
  })
})
