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
export { fetchVideoInfo } from './api/fetchVideoInfo'
export { downloadVideo } from './api/downloadVideo'

// Hooks
export { useVideoInfo } from './hooks/useVideoInfo'

// Redux slices and actions
export { inputSlice, selectAll, deselectAll, updatePartSelected } from './model/inputSlice'
export { videoSlice, setVideo } from './model/videoSlice'

// Selectors
export {
  selectDuplicateIndices,
  selectHasDuplicates,
  selectIsForm1Valid,
  selectAllPartValid,
  selectIsAllValid,
  selectParentProgress,
} from './model/selectors'

// Form schemas and utilities
export { buildVideoFormSchema1, buildVideoFormSchema2, formSchema1 } from './lib/formSchema'
export { normalizeFilename } from './lib/utils'

// Constants
export { VIDEO_QUALITIES_MAP, AUDIO_QUALITIES_MAP, AUDIO_QUALITIES_ORDER } from './lib/constants'

// Types
export type { Input, Video } from './types'

// UI components
export { default as VideoForm1 } from './ui/VideoForm1'
export { default as VideoForm2 } from './ui/VideoForm2'
export { default as DownloadButton } from './ui/DownloadButton'
export { default as DownloadingDialog } from './ui/DownloadingDialog'
