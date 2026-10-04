import { invoke } from '@tauri-apps/api/core'
import type { VideoSearchFilters, VideoSearchResponse } from '../types'

/**
 * Searches bilibili videos by keyword via the `search_videos` command.
 *
 * Works without login (the backend attaches a buvid3 device cookie).
 *
 * @param keyword - Search keyword (non-empty; caller trims)
 * @param page - 1-based page number (20 items per page, fixed by the API)
 * @param filters - Active search filters (order / duration bucket / zone)
 * @throws Error string from the backend, e.g. 'ERR::RATE_LIMITED'
 */
export async function searchVideosApi(
  keyword: string,
  page: number,
  filters: VideoSearchFilters,
): Promise<VideoSearchResponse> {
  return invoke<VideoSearchResponse>('search_videos', {
    keyword,
    page,
    filters,
  })
}
