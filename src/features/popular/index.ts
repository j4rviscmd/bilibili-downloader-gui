/**
 * Popular feed feature - Public API
 *
 * おすすめ (bilibili 综合热门) video feed — the video-search feature's
 * default entry view, backed by the `fetch_popular_videos` Tauri command.
 * Works without login.
 */
export { usePopularFeed } from './hooks/usePopularFeed'
export { default as popularFeedReducer } from './model/popularFeedSlice'
export type { PopularFeedState } from './model/popularFeedSlice'
export { PopularFeedList } from './ui/PopularFeedList'
