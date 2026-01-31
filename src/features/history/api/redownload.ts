import type { HistoryEntry } from '@/features/history/model/historySlice'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'

/**
 * Extracts Bilibili video ID from a URL.
 * Returns null if not found.
 */
const extractVideoId = (url: string): string | null => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match?.[1] ?? null
}

/**
 * Initiates redownload of a video from history.
 *
 * Fetches current video info from Bilibili, then enqueues download
 * using first available quality for each part.
 *
 * @throws Error if video info fetch fails or download fails
 */
export const redownloadFromHistory = async (entry: HistoryEntry): Promise<void> => {
  const videoId = extractVideoId(entry.url)

  if (!videoId) {
    throw new Error('Invalid Bilibili URL')
  }

  const video = await fetchVideoInfo(videoId)

  if (!video || video.parts.length === 0) {
    throw new Error('Video not found or no parts available')
  }

  const parentId = `${videoId}-${Date.now()}`

  for (const part of video.parts) {
    if (part.cid === 0) continue

    const videoQuality = part.videoQualities[0]?.id ?? 80
    const audioQuality = part.audioQualities[0]?.id ?? 30216

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
