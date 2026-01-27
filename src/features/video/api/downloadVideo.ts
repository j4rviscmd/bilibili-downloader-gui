import { store } from '@/app/store'
import { enqueue } from '@/shared/queue/queueSlice'
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
 * @param quality - Video quality ID (e.g., 80 for 1080p)
 * @param audioQuality - Audio quality ID (e.g., 30216 for 64K)
 * @param downloadId - Unique download ID for tracking
 * @param parentId - Optional parent ID for grouping multi-part downloads
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
 *   'BV1xx411c7XD-1234567890'
 * )
 * ```
 */
export const downloadVideo = async (
  videoId: string,
  cid: number,
  filename: string,
  quality: number,
  audioQuality: number,
  downloadId: string,
  parentId?: string,
) => {
  // enqueue prior to backend invoke
  store.dispatch(enqueue({ downloadId, parentId, filename, status: 'pending' }))
  try {
    await invoke<void>('download_video', {
      bvid: videoId,
      cid,
      filename,
      quality,
      audioQuality,
      downloadId,
      parentId,
    })
  } finally {
    // dequeue handled by progress events
  }
}
