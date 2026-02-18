import type { BaseQueryFn } from '@reduxjs/toolkit/query'
import { invoke } from '@tauri-apps/api/core'

type TauriArgs = {
  command: string
  args?: Record<string, unknown>
}

/**
 * Custom baseQuery for RTK Query that wraps Tauri's invoke function.
 *
 * This allows RTK Query to work with Tauri's IPC communication instead of HTTP requests.
 * All the benefits of RTK Query (caching, deduplication, loading states) work seamlessly.
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
  try {
    const result = await invoke(command, args)
    return { data: result }
  } catch (error) {
    return { error: String(error) }
  }
}
