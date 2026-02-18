import { tauriBaseQuery } from '@/app/store/tauriBaseQuery'
import type { Video } from '@/features/video/types'
import { createApi } from '@reduxjs/toolkit/query/react'

/**
 * RTK Query API for video-related operations.
 *
 * Provides cached access to video information fetched from Bilibili via Tauri backend.
 * Cache is maintained for 1 hour (3600 seconds) to reduce redundant API calls.
 */
export const videoApi = createApi({
  reducerPath: 'videoApi',
  baseQuery: tauriBaseQuery,
  endpoints: (builder) => ({
    fetchVideoInfo: builder.query<Video, string>({
      query: (videoId) => ({
        command: 'fetch_video_info',
        args: { videoId },
      }),
      keepUnusedDataFor: 3600, // 1 hour
    }),
  }),
})

export const { useFetchVideoInfoQuery, useLazyFetchVideoInfoQuery } = videoApi
