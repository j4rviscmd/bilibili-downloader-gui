import { invoke } from '@tauri-apps/api/core'
import type { VideoSearchResponse } from '../types'

/**
 * Fetches the popular (综合热门) video feed via the `fetch_popular_videos`
 * command — the search page's entry view before the first keyword search.
 *
 * Works without login (no WBI signing, no device cookie); logged-in users
 * get a personalized ranking.
 *
 * @param page - 1-based page number (20 items per page)
 * @throws Error string from the backend, e.g. 'ERR::RATE_LIMITED'
 */
export async function fetchPopularVideosApi(
  page: number,
): Promise<VideoSearchResponse> {
  return invoke<VideoSearchResponse>('fetch_popular_videos', { page })
}
