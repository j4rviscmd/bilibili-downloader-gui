import type { UpdaterState } from '@/features/updater/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: UpdaterState = {
  updateAvailable: false,
  latestVersion: null,
  currentVersion: null,
  releaseNotes: null,
  downloadProgress: 0,
  isDownloading: false,
  isUpdateReady: false,
  error: null,
  showDialog: false,
}

/**
 * Redux slice for application updater state.
 *
 * Manages the update checking, download progress, and release notes display.
 */
export const updaterSlice = createSlice({
  name: 'updater',
  initialState,
  reducers: {
    /**
     * Sets the update availability status.
     *
     * @param state - Current updater state
     * @param action - Action containing update availability info
     */
    setUpdateAvailable(
      state,
      action: PayloadAction<{
        available: boolean
        latestVersion: string | null
        currentVersion: string | null
      }>,
    ) {
      state.updateAvailable = action.payload.available
      state.latestVersion = action.payload.latestVersion
      state.currentVersion = action.payload.currentVersion
      if (action.payload.available) {
        state.showDialog = true
      }
    },
    /**
     * Sets the release notes content.
     *
     * @param state - Current updater state
     * @param action - Action containing the release notes Markdown
     */
    setReleaseNotes(state, action: PayloadAction<string>) {
      state.releaseNotes = action.payload
    },
    /**
     * Updates the download progress.
     *
     * @param state - Current updater state
     * @param action - Action containing progress percentage (0-100)
     */
    setDownloadProgress(state, action: PayloadAction<number>) {
      state.downloadProgress = action.payload
    },
    /**
     * Sets the downloading state.
     *
     * @param state - Current updater state
     * @param action - Action containing the downloading flag
     */
    setIsDownloading(state, action: PayloadAction<boolean>) {
      state.isDownloading = action.payload
    },
    /**
     * Sets the update ready state.
     *
     * @param state - Current updater state
     * @param action - Action containing the ready flag
     */
    setIsUpdateReady(state, action: PayloadAction<boolean>) {
      state.isUpdateReady = action.payload
    },
    /**
     * Sets an error message.
     *
     * @param state - Current updater state
     * @param action - Action containing the error message
     */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
    /**
     * Controls the update dialog visibility.
     *
     * @param state - Current updater state
     * @param action - Action containing the dialog visibility flag
     */
    setShowDialog(state, action: PayloadAction<boolean>) {
      state.showDialog = action.payload
    },
    /**
     * Resets the updater state to initial values.
     *
     * @param state - Current updater state
     */
    resetUpdater(state) {
      Object.assign(state, initialState)
    },
  },
})

export const {
  setUpdateAvailable,
  setReleaseNotes,
  setDownloadProgress,
  setIsDownloading,
  setIsUpdateReady,
  setError,
  setShowDialog,
  resetUpdater,
} = updaterSlice.actions

export default updaterSlice.reducer
