/**
 * Favorite API functions.
 *
 * Provides Tauri invoke wrappers for Bilibili favorite APIs.
 */

import { invoke } from '@tauri-apps/api/core'

import type { FavoriteFolder, FavoriteVideoListResponse } from '../types'

/**
 * Fetches all favorite folders for the logged-in user.
 *
 * @param mid - User's member ID
 * @returns List of favorite folders
 * @throws Error if cookies are unavailable or API request fails
 */
export async function fetchFavoriteFolders(
  mid: number,
): Promise<FavoriteFolder[]> {
  return invoke<FavoriteFolder[]>('fetch_favorite_folders', { mid })
}

/**
 * Fetches videos from a specific favorite folder with pagination.
 *
 * @param mediaId - Favorite folder ID
 * @param pageNum - Page number (1-indexed)
 * @param pageSize - Number of items per page (max 20)
 * @returns Paginated list of videos with metadata
 * @throws Error if cookies are unavailable or API request fails
 */
export async function fetchFavoriteVideos(
  mediaId: number,
  pageNum: number,
  pageSize: number,
): Promise<FavoriteVideoListResponse> {
  return invoke<FavoriteVideoListResponse>('fetch_favorite_videos', {
    mediaId,
    pageNum,
    pageSize,
  })
}
