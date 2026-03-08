import type {
  AudioQuality,
  SubtitleInfo,
  Video,
  VideoQuality,
} from '@/features/video/types'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/shared/lib/logger'

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
  logger.info(`fetchVideoInfo: Fetching video info for id=${id}`)
  try {
    const result = await invoke<Video>('fetch_video_info', { videoId: id })
    logger.debug(`fetchVideoInfo: Fetched video "${result.title}" with ${result.parts.length} parts`)
    return result
  } catch (error) {
    logger.error(`fetchVideoInfo: Failed to fetch video info for id=${id}`, error)
    throw error
  }
}

/**
 * Fetches available subtitles for a specific video part.
 *
 * Used for lazy-loading subtitles when the user opens the subtitle accordion.
 *
 * @param bvid - Bilibili video ID (BV identifier)
 * @param cid - Content ID for the specific video part
 * @returns A promise resolving to an array of available subtitles
 *
 * @example
 * ```typescript
 * const subtitles = await fetchSubtitlesForPart('BV1xx411c7XD', 123456)
 * console.log('Available subtitles:', subtitles.length)
 * ```
 */
export const fetchSubtitlesForPart = async (
  bvid: string,
  cid: number,
): Promise<SubtitleInfo[]> => {
  logger.debug(`fetchSubtitlesForPart: bvid=${bvid}, cid=${cid}`)
  try {
    const result = await invoke<SubtitleInfo[]>('fetch_subtitles_for_part', { bvid, cid })
    logger.debug(`fetchSubtitlesForPart: Found ${result.length} subtitles`)
    return result
  } catch (error) {
    logger.error(`fetchSubtitlesForPart: Failed to fetch subtitles for bvid=${bvid}, cid=${cid}`, error)
    throw error
  }
}

/**
 * Fetches available video and audio qualities for a specific video part.
 *
 * Used for lazy-loading qualities when the part is rendered.
 *
 * @param bvid - Bilibili video ID (BV identifier)
 * @param cid - Content ID for the specific video part
 * @returns A promise resolving to a tuple of [videoQualities, audioQualities]
 *
 * @example
 * ```typescript
 * const [videoQualities, audioQualities] = await fetchPartQualities('BV1xx411c7XD', 123456)
 * console.log('Video qualities:', videoQualities.length)
 * ```
 */
export const fetchPartQualities = async (
  bvid: string,
  cid: number,
): Promise<[VideoQuality[], AudioQuality[]]> => {
  logger.debug(`fetchPartQualities: bvid=${bvid}, cid=${cid}`)
  try {
    const result = await invoke<[VideoQuality[], AudioQuality[]]>(
      'fetch_part_qualities',
      { bvid, cid },
    )
    logger.debug(`fetchPartQualities: Found ${result[0].length} video qualities, ${result[1].length} audio qualities`)
    return result
  } catch (error) {
    logger.error(`fetchPartQualities: Failed to fetch qualities for bvid=${bvid}, cid=${cid}`, error)
    throw error
  }
}

/**
 * Fetches available video and audio qualities for a bangumi episode part.
 *
 * Used for lazy-loading qualities when the bangumi part is rendered.
 *
 * @param epId - Bangumi episode ID
 * @param cid - Content ID for the specific video part
 * @returns A promise resolving to a tuple of [videoQualities, audioQualities, isPreview]
 *
 * @example
 * ```typescript
 * const [videoQualities, audioQualities, isPreview] = await fetchBangumiPartQualities(3051843, 123456)
 * console.log('Video qualities:', videoQualities.length)
 * console.log('Preview mode:', isPreview)
 * ```
 */
export const fetchBangumiPartQualities = async (
  epId: number,
  cid: number,
): Promise<[VideoQuality[], AudioQuality[], boolean | null]> => {
  logger.debug(`fetchBangumiPartQualities: epId=${epId}, cid=${cid}`)
  try {
    const result = await invoke<[VideoQuality[], AudioQuality[], boolean | null]>(
      'fetch_bangumi_part_qualities',
      { epId, cid },
    )
    logger.debug(`fetchBangumiPartQualities: Found ${result[0].length} video qualities, ${result[1].length} audio qualities, isPreview=${result[2]}`)
    return result
  } catch (error) {
    logger.error(`fetchBangumiPartQualities: Failed to fetch qualities for epId=${epId}, cid=${cid}`, error)
    throw error
  }
}
