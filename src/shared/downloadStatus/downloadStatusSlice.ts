import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type DownloadStatusState = {
  hasError: boolean
  errorMessage?: string
}

const initialState: DownloadStatusState = {
  hasError: false,
  errorMessage: undefined,
}

const downloadStatusSlice = createSlice({
  name: 'downloadStatus',
  initialState,
  reducers: {
    setError(state, action: PayloadAction<string>) {
      state.hasError = true
      state.errorMessage = action.payload
    },
    clearError(state) {
      state.hasError = false
      state.errorMessage = undefined
    },
  },
})

export const { setError, clearError } = downloadStatusSlice.actions
export default downloadStatusSlice.reducer
