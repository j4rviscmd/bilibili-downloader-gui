/**
 * Video search feature - Public API
 *
 * Keyword search over bilibili videos (`search_type=video`), backed by the
 * `search_videos` Tauri command. Works without login.
 */
export { fetchPopularVideosApi } from './api/fetchPopularVideos'
export { useHomeRecommendations } from './hooks/useHomeRecommendations'
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
export { HomeRecommendations } from './ui/HomeRecommendations'
export { VideoCardGrid, VideoCardSkeletonGrid } from './ui/VideoCardGrid'
export { VideoSearchFeedTail } from './ui/VideoSearchFeedTail'
export { VideoSearchFilterBar } from './ui/VideoSearchFilterBar'
export { VideoSearchInput } from './ui/VideoSearchInput'
export { VideoSearchResultList } from './ui/VideoSearchResultList'
