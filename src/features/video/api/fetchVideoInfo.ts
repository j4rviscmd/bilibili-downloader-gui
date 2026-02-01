import type { Video } from '@/features/video/types'
import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches video metadata from Bilibili.
 *
 * Invokes the 'fetch_video_info' Tauri command to retrieve video information
 * including title, parts (episodes), available quality options, and thumbnails.
 *
 * @param id - Bilibili video ID (e.g., 'BV1xx411c7XD')
 * @returns A promise resolving to the video object
 * @throws Error if the video is not found or if the request fails
 *
 * @example
 * ```typescript
 * try {
 *   const video = await fetchVideoInfo('BV1xx411c7XD')
 *   console.log('Title:', video.title)
 *   console.log('Parts:', video.parts.length)
 * } catch (e) {
 *   console.error('Failed to fetch video:', e)
 * }
 * ```
 */
export const fetchVideoInfo = async (id: string): Promise<Video> => {
  return await invoke<Video>('fetch_video_info', { videoId: id })
}
