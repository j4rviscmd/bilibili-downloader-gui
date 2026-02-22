import type {
  AudioQuality,
  Input,
  PendingDownload,
  SubtitleConfig,
  SubtitleInfo,
  VideoQuality,
} from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

export const defaultSubtitleConfig: SubtitleConfig = {
  mode: 'off',
  selectedLans: [],
}

const initialState: Input = {
  url: '',
  partInputs: [],
  pendingDownload: null,
}

/**
 * Redux slice for video download input state.
 *
 * Manages user input for video downloads including:
 * - Video URL
 * - Per-part settings (title, quality, selection)
 * - Bulk selection/deselection
 */
export const inputSlice = createSlice({
  name: 'input',
  initialState,
  reducers: {
    /**
     * Replaces the entire input state.
     *
     * @param _ - Previous state (unused, will be replaced)
     * @param action - Action containing the new input
     */
    setInput: (_, action: PayloadAction<Input>) => {
      return action.payload
    },
    /**
     * Updates the video URL.
     *
     * @param state - Current input state
     * @param action - Action containing the new URL
     */
    setUrl: (state, action: PayloadAction<string>) => {
      state.url = action.payload
    },
    /**
     * Initializes part input settings from fetched video metadata.
     *
     * Replaces the entire partInputs array with the provided configuration.
     * Typically called after fetching video info to set up default quality
     * selections and mark all parts as selected.
     *
     * @param state - Current input state
     * @param action - Action containing the array of part input configurations
     */
    initPartInputs: (
      state,
      action: PayloadAction<
        {
          cid: number
          page: number
          title: string
          videoQuality: string
          audioQuality: string
          selected: boolean
          duration: number
          subtitle?: SubtitleConfig
        }[]
      >,
    ) => {
      state.partInputs = action.payload.map((p) => ({
        ...p,
        subtitle: p.subtitle ?? defaultSubtitleConfig,
      }))
    },
    /**
     * Updates specific fields of a part input by index.
     *
     * Only updates the fields provided in the payload; other fields remain unchanged.
     * Safely handles out-of-bounds indices by returning early.
     *
     * @param state - Current input state
     * @param action - Action containing the index and fields to update
     */
    updatePartInputByIndex: (
      state,
      action: PayloadAction<{
        index: number
        title?: string
        videoQuality?: string
        audioQuality?: string
      }>,
    ) => {
      const { index, title, videoQuality, audioQuality } = action.payload
      const target = state.partInputs[index]
      if (!target) return
      if (title !== undefined) target.title = title
      if (videoQuality !== undefined) target.videoQuality = videoQuality
      if (audioQuality !== undefined) target.audioQuality = audioQuality
    },
    /**
     * Updates the selection state of a specific part.
     *
     * @param state - Current input state
     * @param action - Action containing the index and new selection state
     */
    updatePartSelected: (
      state,
      action: PayloadAction<{ index: number; selected: boolean }>,
    ) => {
      const { index, selected } = action.payload
      const target = state.partInputs[index]
      if (target) target.selected = selected
    },
    /**
     * Selects all video parts for download.
     *
     * @param state - Current input state
     */
    selectAll: (state) => {
      state.partInputs.forEach((p) => {
        p.selected = true
      })
    },
    /**
     * Deselects all video parts.
     *
     * @param state - Current input state
     */
    deselectAll: (state) => {
      state.partInputs.forEach((p) => {
        p.selected = false
      })
    },
    /**
     * Selects all video parts on a specific page.
     *
     * @param state - Current input state
     * @param action - Action containing startIndex and endIndex (inclusive)
     */
    selectPageAll: (
      state,
      action: PayloadAction<{ startIndex: number; endIndex: number }>,
    ) => {
      const { startIndex, endIndex } = action.payload
      for (let i = startIndex; i <= endIndex; i++) {
        const target = state.partInputs[i]
        if (target) target.selected = true
      }
    },
    /**
     * Deselects all video parts on a specific page.
     *
     * @param state - Current input state
     * @param action - Action containing startIndex and endIndex (inclusive)
     */
    deselectPageAll: (
      state,
      action: PayloadAction<{ startIndex: number; endIndex: number }>,
    ) => {
      const { startIndex, endIndex } = action.payload
      for (let i = startIndex; i <= endIndex; i++) {
        const target = state.partInputs[i]
        if (target) target.selected = false
      }
    },
    /**
     * Resets the input state to initial values.
     *
     * Used after download completion to clear the form.
     */
    resetInput: () => {
      return initialState
    },
    /**
     * Sets a pending download from watch history navigation.
     *
     * Used to initiate automatic download when navigating from
     * the watch history page.
     *
     * @param state - Current input state
     * @param action - Action containing the pending download info
     */
    setPendingDownload: (state, action: PayloadAction<PendingDownload>) => {
      state.pendingDownload = action.payload
    },
    /**
     * Clears the pending download.
     *
     * Called after the pending download has been processed.
     *
     * @param state - Current input state
     */
    clearPendingDownload: (state) => {
      state.pendingDownload = null
    },
    /**
     * Updates subtitle configuration for a specific part.
     *
     * @param state - Current input state
     * @param action - Action containing the index and subtitle config
     */
    updateSubtitleConfig: (
      state,
      action: PayloadAction<{ index: number; config: SubtitleConfig }>,
    ) => {
      const { index, config } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.subtitle = config
      }
    },
    /**
     * Sets subtitles loading state for a specific part.
     *
     * @param state - Current input state
     * @param action - Action containing the index and loading state
     */
    setSubtitlesLoading: (
      state,
      action: PayloadAction<{ index: number; loading: boolean }>,
    ) => {
      const { index, loading } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.subtitlesLoading = loading
      }
    },
    /**
     * Sets subtitles for a specific part (lazy loading).
     *
     * @param state - Current input state
     * @param action - Action containing the index and subtitles
     */
    setPartSubtitles: (
      state,
      action: PayloadAction<{ index: number; subtitles: SubtitleInfo[] }>,
    ) => {
      const { index, subtitles } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.subtitles = subtitles
        target.subtitlesLoading = false
      }
    },
    /**
     * Sets qualities loading state for a specific part.
     *
     * @param state - Current input state
     * @param action - Action containing the index and loading state
     */
    setQualitiesLoading: (
      state,
      action: PayloadAction<{ index: number; loading: boolean }>,
    ) => {
      const { index, loading } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.qualitiesLoading = loading
      }
    },
    /**
     * Sets qualities for a specific part (lazy loading).
     *
     * @param state - Current input state
     * @param action - Action containing the index and qualities
     */
    setPartQualities: (
      state,
      action: PayloadAction<{
        index: number
        videoQualities: VideoQuality[]
        audioQualities: AudioQuality[]
      }>,
    ) => {
      const { index, videoQualities, audioQualities } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.videoQualities = videoQualities
        target.audioQualities = audioQualities
        target.qualitiesLoading = false
        if (videoQualities.length > 0 && !target.videoQuality) {
          target.videoQuality = String(videoQualities[0].id)
        }
        if (audioQualities.length > 0 && !target.audioQuality) {
          target.audioQuality = String(audioQualities[0].id)
        }
      }
    },
    /**
     * Sets the accordion open state for a specific part.
     *
     * Persists the open/closed state so that virtual scroll can
     * restore it when the component is re-mounted.
     *
     * @param state - Current input state
     * @param action - Action containing the index and open state
     */
    setAccordionOpen: (
      state,
      action: PayloadAction<{ index: number; open: boolean }>,
    ) => {
      const { index, open } = action.payload
      const target = state.partInputs[index]
      if (target) {
        target.accordionOpen = open
      }
    },
  },
})

export const {
  clearPendingDownload,
  deselectAll,
  deselectPageAll,
  initPartInputs,
  resetInput,
  selectAll,
  selectPageAll,
  setAccordionOpen,
  setInput,
  setPartQualities,
  setPartSubtitles,
  setPendingDownload,
  setQualitiesLoading,
  setSubtitlesLoading,
  setUrl,
  updatePartInputByIndex,
  updatePartSelected,
  updateSubtitleConfig,
} = inputSlice.actions
export default inputSlice.reducer
