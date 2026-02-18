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
): Promise<boolean> => invoke<boolean>('cancel_download', { downloadId })

/**
 * Cancels all active downloads.
 *
 * Calls the 'cancel_all_downloads' Tauri command to stop all in-progress downloads.
 * Each cancelled download emits a 'download_cancelled' event.
 *
 * @returns Promise that resolves to the number of cancelled downloads
 *
 * @example
 * ```typescript
 * const count = await callCancelAllDownloads()
 * console.log(`Cancelled ${count} downloads`)
 * ```
 */
export const callCancelAllDownloads = async (): Promise<number> =>
  invoke<number>('cancel_all_downloads')
