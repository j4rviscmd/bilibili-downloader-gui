import type { Video } from '@/features/video/types'
import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches video metadata from Bilibili.
 *
 * Invokes the 'fetch_video_info' Tauri command to retrieve video information
 * including title, parts (episodes), available quality options, and thumbnails.
 * Returns null if the video is not found or if the request fails.
 *
 * @param id - Bilibili video ID (e.g., 'BV1xx411c7XD')
 * @returns A promise resolving to the video object or null if unavailable
 *
 * @example
 * ```typescript
 * const video = await fetchVideoInfo('BV1xx411c7XD')
 * if (video) {
 *   console.log('Title:', video.title)
 *   console.log('Parts:', video.parts.length)
 * }
 * ```
 */
export const fetchVideoInfo = async (id: string) => {
  let res: Video | null = null
  try {
    res = await invoke<Video>('fetch_video_info', { videoId: id })
  } catch (e) {
    console.error(e)
    res = null
  }

  return res
}
