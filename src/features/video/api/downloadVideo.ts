import { store } from '@/app/store'
import type { SubtitleConfig } from '@/features/video/types'
import { logger } from '@/shared/lib/logger'
import {
  enqueue,
  updateQueueItem,
  updateQueueStatus,
} from '@/shared/queue/queueSlice'
import { invoke } from '@tauri-apps/api/core'

/**
 * Initiates a video download via the Tauri backend.
 *
 * Enqueues the download to the Redux queue, then invokes the 'download_video'
 * Tauri command. The backend handles fetching video/audio streams, merging
 * with ffmpeg, and emitting progress events. Dequeuing is handled automatically
 * by progress event listeners.
 *
 * @param videoId - Bilibili video ID (e.g., 'BV1xx411c7XD')
 * @param cid - Video part CID (unique identifier for each part)
 * @param filename - Output filename (without extension)
 * @param quality - Video quality ID (e.g., 80 for 1080p), or null for best available
 * @param audioQuality - Audio quality ID (e.g., 30216 for 64K), null for durl format
 * @param downloadId - Unique download ID for tracking
 * @param parentId - Optional parent ID for grouping multi-part downloads
 * @param durationSeconds - Video duration in seconds for accurate merge progress
 * @param thumbnailUrl - Optional thumbnail URL for history
 * @param page - Optional page number for multi-part videos
 * @param subtitle - Optional subtitle configuration
 * @param epId - Optional episode ID for bangumi content
 *
 * @throws Error if backend download fails (network error, quality not found, etc.)
 *
 * @example
 * ```typescript
 * await downloadVideo(
 *   'BV1xx411c7XD',
 *   123456,
 *   'My Video',
 *   80,
 *   30216,
 *   'BV1xx411c7XD-1234567890-p1',
 *   'BV1xx411c7XD-1234567890',
 *   360, // 6 minutes
 *   null,
 *   1,
 *   { mode: 'soft', selectedLans: ['zh-CN'] }
 * )
 * ```
 */
export const downloadVideo = async (
  videoId: string,
  cid: number,
  filename: string,
  quality: number | null,
  audioQuality: number | null,
  downloadId: string,
  parentId?: string,
  durationSeconds?: number,
  thumbnailUrl?: string,
  page?: number,
  subtitle?: SubtitleConfig,
  epId?: number,
) => {
  logger.info(
    `downloadVideo: starting id=${downloadId}, videoId=${videoId}, cid=${cid}`,
  )
  store.dispatch(enqueue({ downloadId, parentId, filename, status: 'pending' }))

  const subtitleOptions = subtitle
    ? { mode: subtitle.mode, selectedLans: subtitle.selectedLans }
    : null

  try {
    const outputPath = await invoke<string>('download_video', {
      options: {
        bvid: videoId,
        cid,
        filename,
        quality,
        audioQuality,
        downloadId,
        parentId: parentId ?? null,
        durationSeconds: durationSeconds ?? 0,
        thumbnailUrl: thumbnailUrl ?? null,
        page: page ?? null,
        epId: epId ?? null,
        subtitle: subtitleOptions,
      },
    })
    logger.info(
      `downloadVideo: completed id=${downloadId}, outputPath=${outputPath}`,
    )
    store.dispatch(updateQueueItem({ downloadId, outputPath, title: filename }))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`downloadVideo: failed id=${downloadId}`, error)
    store.dispatch(
      updateQueueStatus({ downloadId, status: 'error', errorMessage }),
    )
    throw error
  }
}
