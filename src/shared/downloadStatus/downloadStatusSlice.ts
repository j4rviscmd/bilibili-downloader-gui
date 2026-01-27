import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/**
 * Download status state shape.
 */
export type DownloadStatusState = {
  /** Whether a download error has occurred */
  hasError: boolean
  /** Error message if hasError is true */
  errorMessage?: string
}

const initialState: DownloadStatusState = {
  hasError: false,
  errorMessage: undefined,
}

/**
 * Redux slice for download error status.
 *
 * Tracks whether a download error has occurred and stores the error message.
 * Used to display error dialogs and disable download actions.
 */
const downloadStatusSlice = createSlice({
  name: 'downloadStatus',
  initialState,
  reducers: {
    /**
     * Sets an error state with a message.
     *
     * @param state - Current status state
     * @param action - Action containing the error message
     */
    setError(state, action: PayloadAction<string>) {
      state.hasError = true
      state.errorMessage = action.payload
    },
    /**
     * Clears the error state.
     *
     * @param state - Current status state
     */
    clearError(state) {
      state.hasError = false
      state.errorMessage = undefined
    },
  },
})

export const { setError, clearError } = downloadStatusSlice.actions
export default downloadStatusSlice.reducer
