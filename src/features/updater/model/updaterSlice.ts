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
     * Sets the update availability status and shows dialog if available.
     *
     * `showDialog` overrides the default `available` coupling: the startup
     * auto-check passes false for a version the user skipped (issue #599)
     * while keeping `updateAvailable` true for the AppBar update button
     * and the settings badge.
     */
    setUpdateAvailable(
      state,
      action: PayloadAction<{
        available: boolean
        latestVersion: string | null
        currentVersion: string | null
        showDialog?: boolean
      }>,
    ) {
      state.updateAvailable = action.payload.available
      state.latestVersion = action.payload.latestVersion
      state.currentVersion = action.payload.currentVersion
      state.showDialog = action.payload.showDialog ?? action.payload.available
    },
    /**
     * Sets the release notes content. Null clears them (the dialog body
     * falls back to its loading spinner while a fetch is in flight).
     */
    setReleaseNotes(state, action: PayloadAction<string | null>) {
      state.releaseNotes = action.payload
    },
    /** Updates the download progress percentage (0-100). */
    setDownloadProgress(state, action: PayloadAction<number>) {
      state.downloadProgress = action.payload
    },
    /** Sets the downloading state. */
    setIsDownloading(state, action: PayloadAction<boolean>) {
      state.isDownloading = action.payload
    },
    /** Sets the update ready state. */
    setIsUpdateReady(state, action: PayloadAction<boolean>) {
      state.isUpdateReady = action.payload
    },
    /** Sets an error message. */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
    /** Controls the update dialog visibility. */
    setShowDialog(state, action: PayloadAction<boolean>) {
      state.showDialog = action.payload
    },
    /** Resets the updater state to initial values. */
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
