import { tauriBaseQuery } from '@/app/store/tauriBaseQuery'
import { type ExtractedId, extractContentId } from '@/features/video/lib/utils'
import type { Video } from '@/features/video/types'
import { createApi } from '@reduxjs/toolkit/query/react'

/**
 * Arguments for fetching content info.
 */
type FetchContentInfoArgs =
  | { type: 'video'; id: string }
  | { type: 'bangumi'; epId: number }

/**
 * RTK Query API for video-related operations.
 *
 * Provides cached access to video and bangumi information fetched from Bilibili
 * via Tauri backend. Cache is maintained for 1 hour (3600 seconds) to reduce
 * redundant API calls.
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
    fetchBangumiInfo: builder.query<Video, number>({
      query: (epId) => ({
        command: 'fetch_bangumi_info',
        args: { epId },
      }),
      keepUnusedDataFor: 3600, // 1 hour
    }),
    /**
     * Unified content fetcher that handles both videos and bangumi.
     * Use extractContentId to parse URL before calling this endpoint.
     */
    fetchContentInfo: builder.query<Video, ExtractedId>({
      query: (contentId) => {
        if (!contentId) {
          throw new Error('Invalid content ID')
        }
        if (contentId.type === 'video') {
          return {
            command: 'fetch_video_info',
            args: { videoId: contentId.id },
          }
        }
        return {
          command: 'fetch_bangumi_info',
          args: { epId: parseInt(contentId.epId, 10) },
        }
      },
      keepUnusedDataFor: 3600, // 1 hour
    }),
  }),
})

export const {
  useFetchVideoInfoQuery,
  useLazyFetchVideoInfoQuery,
  useFetchBangumiInfoQuery,
  useLazyFetchBangumiInfoQuery,
  useFetchContentInfoQuery,
  useLazyFetchContentInfoQuery,
} = videoApi

/**
 * Helper function to fetch content info from a URL.
 * Parses the URL and calls the appropriate API endpoint.
 *
 * @param url - Bilibili video or bangumi URL
 * @returns The content info or null if URL is invalid
 *
 * @example
 * ```typescript
 * const info = await fetchContentFromUrl('https://www.bilibili.com/video/BV1xx411c7XD')
 * const bangumi = await fetchContentFromUrl('https://www.bilibili.com/bangumi/play/ep3051843')
 * ```
 */
export const fetchContentFromUrl = (
  url: string,
): FetchContentInfoArgs | null => {
  const contentId = extractContentId(url)
  if (!contentId) return null

  if (contentId.type === 'video') {
    return { type: 'video', id: contentId.id }
  }
  return { type: 'bangumi', epId: parseInt(contentId.epId, 10) }
}
