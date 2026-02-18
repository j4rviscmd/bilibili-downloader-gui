import { invoke } from '@tauri-apps/api/core'

/**
 * ID による特定のダウンロードをキャンセルします。
 *
 * ダウンロードを停止するために 'cancel_download' Tauri コマンドを呼び出します。
 * バックエンドは一時ファイルをクリーンアップし、'download_cancelled' イベントを発行します。
 *
 * @param downloadId - キャンセルするダウンロードのユニーク識別子
 * @returns ダウンロードが見つかりキャンセルされた場合は `true` に解決される Promise、
 *          ダウンロードが見つからなかった場合は `false`（既に完了している可能性があります）
 *
 * @example
 * ```typescript
 * const wasCancelled = await callCancelDownload('BV1234567890-p1')
 * if (wasCancelled) {
 *   console.log('Download cancelled successfully')
 * }
 * ```
 */
export const callCancelDownload = async (downloadId: string): Promise<boolean> =>
  invoke<boolean>('cancel_download', { downloadId })

/**
 * すべてのアクティブなダウンロードをキャンセルします。
 *
 * 進行中のすべてのダウンロードを停止するために 'cancel_all_downloads' Tauri コマンドを呼び出します。
 * キャンセルされた各ダウンロードは 'download_cancelled' イベントを発行します。
 *
 * @returns キャンセルされたダウンロード数に解決される Promise
 *
 * @example
 * ```typescript
 * const count = await callCancelAllDownloads()
 * console.log(`Cancelled ${count} downloads`)
 * ```
 */
export const callCancelAllDownloads = async (): Promise<number> =>
  invoke<number>('cancel_all_downloads')
