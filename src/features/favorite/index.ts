/**
 * Favorite feature module.
 *
 * Provides Bilibili favorite folders and video management.
 *
 * @module favorite
 */

// Public API: Components
export { default as FavoriteItem } from './ui/FavoriteItem'
export { default as FavoriteList } from './ui/FavoriteList'
export { default as FolderSelector } from './ui/FolderSelector'

// Public API: Hooks
export {
  formatDuration,
  formatPlayCount,
  useFavorite,
} from './hooks/useFavorite'

// Public API: Redux Slice
export {
  appendVideos,
  favoriteSlice,
  reset,
  setError,
  setFolders,
  setLoading,
  setSelectedFolder,
  setVideos,
} from './model/favoriteSlice'

// Public API: Types
export type { FavoriteState } from './model/favoriteSlice'
export type {
  FavoriteFolder,
  FavoriteFolderUpper,
  FavoriteVideo,
  FavoriteVideoListResponse,
  FavoriteVideoUpper,
} from './types'
