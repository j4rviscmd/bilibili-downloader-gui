import {
  handleSessionExpiry,
  isUnauthorizedError,
} from '@/app/lib/invokeErrorHandler'
import { logger } from '@/shared/lib/logger'
import type { BaseQueryFn } from '@reduxjs/toolkit/query'
import { invoke } from '@tauri-apps/api/core'
import { store } from '.'

/**
 * Shape returned by each RTK Query endpoint's `query` function.
 *
 * @param command - Tauri command name (must match a
 *   `#[tauri::command]` registered in `invoke_handler`)
 * @param args - Key-value arguments forwarded to `invoke()`
 */
type TauriArgs = {
  command: string
  args?: Record<string, unknown>
}

/**
 * Custom baseQuery for RTK Query that wraps Tauri's invoke function.
 *
 * This allows RTK Query to work with Tauri's IPC communication instead
 * of HTTP requests. All the benefits of RTK Query (caching,
 * deduplication, loading states) work seamlessly.
 *
 * Includes session expiry interception: when the backend returns
 * ERR::UNAUTHORIZED (-101 from Bilibili API), the user is automatically
 * logged out and notified via toast.
 *
 * @example
 * ```typescript
 * const api = createApi({
 *   baseQuery: tauriBaseQuery,
 *   endpoints: (builder) => ({
 *     fetchVideo: builder.query<Video, string>({
 *       query: (videoId) => ({
 *         command: 'fetch_video_info',
 *         args: { videoId },
 *       }),
 *     }),
 *   }),
 * })
 * ```
 */
export const tauriBaseQuery: BaseQueryFn<TauriArgs> = async ({
  command,
  args = {},
}) => {
  logger.debug(`API call: ${command}`)
  try {
    const result = await invoke(command, args)
    return { data: result }
  } catch (error) {
    const errorString = String(error)
    logger.error(`API error: ${command}`, error)

    if (isUnauthorizedError(errorString)) {
      handleSessionExpiry(store)
    }

    return { error: errorString }
  }
}
