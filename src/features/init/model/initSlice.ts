import type { InitState } from '@/features/init/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: InitState = { initiated: false, processingFnc: '' }

/**
 * Redux slice for application initialization state.
 *
 * Manages the initialization status and current processing message
 * displayed during app startup.
 */
export const initSlice = createSlice({
  name: 'init',
  initialState,
  reducers: {
    /**
     * Sets the initialization completion flag.
     *
     * @param state - Current init state
     * @param action - Action containing the new initiated value
     */
    setInitiated(state, action: PayloadAction<boolean>) {
      state.initiated = action.payload
    },
    /**
     * Updates the current initialization status message.
     *
     * @param state - Current init state
     * @param action - Action containing the new status message
     */
    setProcessingFnc(state, action: PayloadAction<string>) {
      state.processingFnc = action.payload
    },
  },
})

export const { setInitiated, setProcessingFnc } = initSlice.actions
export default initSlice.reducer
