/**
 * Video search feature - Public API
 *
 * Keyword search over bilibili videos (`search_type=video`), backed by the
 * `search_videos` Tauri command. Works without login.
 */
export { useVideoSearch } from './hooks/useVideoSearch'
export type { VideoSearchView } from './hooks/useVideoSearch'
export { default as videoSearchReducer } from './model/videoSearchSlice'
export type {
  VideoSearchEntry,
  VideoSearchFilters,
  VideoSearchOrder,
  VideoSearchResponse,
  VideoSearchState,
} from './types'
export { VideoSearchFilterBar } from './ui/VideoSearchFilterBar'
export { VideoSearchInput } from './ui/VideoSearchInput'
export { VideoSearchPagination } from './ui/VideoSearchPagination'
export { VideoSearchResultList } from './ui/VideoSearchResultList'
