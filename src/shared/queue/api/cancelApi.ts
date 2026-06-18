import { logger } from '@/shared/lib/logger'
import { invoke } from '@tauri-apps/api/core'

/**
 * Cancels a specific download by ID.
 *
 * Calls the 'cancel_download' Tauri command to stop the download.
 * The backend cleans up temporary files and emits a 'download_cancelled' event.
 *
 * @param downloadId - Unique identifier of the download to cancel
 * @returns Promise that resolves to `true` if download was found and cancelled,
 *          or `false` if download was not found (may have already completed)
 *
 * @example
 * ```typescript
 * const wasCancelled = await callCancelDownload('BV1234567890-p1')
 * if (wasCancelled) {
 *   console.log('Download cancelled successfully')
 * }
 * ```
 */
export const callCancelDownload = async (
  downloadId: string,
): Promise<boolean> => {
  logger.info(`callCancelDownload: id=${downloadId}`)
  const result = await invoke<boolean>('cancel_download', { downloadId })
  if (result) {
    logger.info(`callCancelDownload: cancelled id=${downloadId}`)
  } else {
    logger.warn(`callCancelDownload: not found id=${downloadId}`)
  }
  return result
}

/**
 * Cancels all active downloads.
 *
 * Calls the 'cancel_all_downloads' Tauri command to stop all in-progress
 * downloads. The backend also pre-marks the given IDs (including not-yet-
 * started pending children) so download_video rejects them on start.
 * Each active download emits a 'download_cancelled' event.
 *
 * @param downloadIds - IDs to cancel (pending + running)
 * @returns Promise that resolves to the number of cancelled active downloads
 *
 * @example
 * ```typescript
 * const count = await callCancelAllDownloads(['BV123-p1', 'BV123-p2'])
 * console.log(`Cancelled ${count} downloads`)
 * ```
 */
export const callCancelAllDownloads = async (
  downloadIds: string[],
): Promise<number> => {
  const count = await invoke<number>('cancel_all_downloads', { downloadIds })
  logger.info(`callCancelAllDownloads: cancelled ${count} downloads`)
  return count
}
