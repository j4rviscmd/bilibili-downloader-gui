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
export { useFavorite, formatDuration, formatPlayCount } from './hooks/useFavorite'

// Public API: Redux Slice
export { favoriteSlice, setFolders, setSelectedFolder, setVideos, appendVideos, setLoading, setError, reset } from './model/favoriteSlice'

// Public API: Types
export type { FavoriteFolder, FavoriteVideo, FavoriteVideoListResponse, FavoriteFolderUpper, FavoriteVideoUpper } from './types'
export type { FavoriteState } from './model/favoriteSlice'
