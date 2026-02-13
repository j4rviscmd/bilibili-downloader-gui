/**
 * Favorite feature types.
 *
 * Defines TypeScript types for Bilibili favorite folders and videos.
 */

/**
 * Upper (creator) information for favorite folder.
 */
export type FavoriteFolderUpper = {
  mid: number
  name: string
  face: string
}

/**
 * Favorite folder information.
 */
export type FavoriteFolder = {
  id: number
  title: string
  cover?: string | null
  mediaCount: number
  upper?: FavoriteFolderUpper | null
}

/**
 * Upper (uploader) information for favorite video.
 */
export type FavoriteVideoUpper = {
  mid: number
  name: string
  face: string
}

/**
 * Favorite video item.
 */
export type FavoriteVideo = {
  id: number
  bvid: string
  title: string
  cover: string
  duration: number
  page: number
  upper: FavoriteVideoUpper
  attr: number
  playCount: number
  collectCount: number
  link: string
}

/**
 * Paginated favorite video list response.
 */
export type FavoriteVideoListResponse = {
  videos: FavoriteVideo[]
  hasMore: boolean
  totalCount: number
}
