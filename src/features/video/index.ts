/**
 * Public API for the video feature.
 *
 * Handles Bilibili video information fetching, download orchestration,
 * quality selection, and multi-part video management. Includes form
 * validation, filename normalization, and UI components for the entire
 * video download workflow.
 * @module features/video
 */

// API functions
export { downloadVideo } from './api/downloadVideo'
export { fetchVideoInfo } from './api/fetchVideoInfo'
export {
  useFetchVideoInfoQuery,
  useLazyFetchVideoInfoQuery,
  videoApi,
} from './api/videoApi'

// Context
export { VideoInfoProvider, useVideoInfo } from './context/VideoInfoContext'
export type { VideoInfoContextValue } from './context/VideoInfoContext'

// Redux slices and actions
export {
  clearPendingDownload,
  deselectAll,
  inputSlice,
  selectAll,
  setPendingDownload,
  updatePartSelected,
} from './model/inputSlice'
export { setVideo, videoSlice } from './model/videoSlice'

// Selectors
export {
  selectAllPartValid,
  selectDuplicateIndices,
  selectHasDuplicates,
  selectIsAllValid,
  selectIsForm1Valid,
  selectParentProgress,
} from './model/selectors'

// Form schemas and utilities
export {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
  formSchema1,
} from './lib/formSchema'
export { normalizeFilename } from './lib/utils'

// Constants
export {
  AUDIO_QUALITIES_MAP,
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_MAP,
} from './lib/constants'

// Types
export type { Input, PendingDownload, Video } from './types'

// UI components
export { default as DownloadButton } from './ui/DownloadButton'
export { default as VideoForm1 } from './ui/VideoForm1'
