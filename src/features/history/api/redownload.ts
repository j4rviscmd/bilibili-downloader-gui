import type { HistoryEntry } from '@/features/history/model/historySlice'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'

/**
 * Extracts Bilibili video ID from a URL.
 *
 * @param url - The Bilibili video URL.
 * @returns The video ID (e.g., 'BV1xx411c7XD') or null if not found.
 */
const extractId = (url: string) => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

/**
 * Initiates redownload of a video from history.
 *
 * Fetches current video info from Bilibili, then enqueues download
 * using first available quality for each part. The quality selection
 * follows the pattern from useVideoInfo hook - uses first available
 * video and audio quality.
 *
 * @param entry - The history entry to redownload
 * @throws Error if video info fetch fails or download fails
 *
 * @example
 * ```typescript
 * try {
 *   await redownloadFromHistory({
 *     id: 'abc123',
 *     title: 'My Video',
 *     url: 'https://bilibili.com/video/BV1xx',
 *     downloadedAt: '2024-01-15T10:30:00Z',
 *     status: 'completed'
 *   })
 * } catch (error) {
 *   console.error('Redownload failed:', error)
 * }
 * ```
 */
export const redownloadFromHistory = async (entry: HistoryEntry) => {
  const videoId = extractId(entry.url)

  if (!videoId) {
    throw new Error('Invalid Bilibili URL')
  }

  const video = await fetchVideoInfo(videoId)

  if (!video || video.parts.length === 0) {
    throw new Error('Video not found or no parts available')
  }

  const parentId = `${videoId}-${Date.now()}`

  for (const part of video.parts) {
    if (part.cid === 0) {
      continue
    }

    const videoQuality = part.videoQualities[0]?.id || 80
    const audioQuality = part.audioQualities[0]?.id || 30216

    await downloadVideo(
      videoId,
      part.cid,
      `${entry.title} ${part.part}`,
      videoQuality,
      audioQuality,
      `${parentId}-p${part.page}`,
      parentId,
    )
  }
}
