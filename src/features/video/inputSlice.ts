import type { Input } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

// TODO: remove debug
const initialState: Input = {
  url: 'https://www.bilibili.com/video/BV1pJ411E7Eb',
}

export const inputSlice = createSlice({
  name: 'input',
  initialState,
  reducers: {
    setUrl(state, action: PayloadAction<string>) {
      state.url = action.payload
    },
  },
})

export const { setUrl } = inputSlice.actions
export default inputSlice.reducer
