import type { InitState } from '@/features/init/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: InitState = { initiated: false, processingFnc: '' }

export const initSlice = createSlice({
  name: 'init',
  initialState,
  reducers: {
    setInitiated(state, action: PayloadAction<boolean>) {
      state.initiated = action.payload
    },
    setProcessingFnc(state, action: PayloadAction<string>) {
      state.processingFnc = action.payload
    },
  },
})

export const { setInitiated, setProcessingFnc } = initSlice.actions
export default initSlice.reducer
