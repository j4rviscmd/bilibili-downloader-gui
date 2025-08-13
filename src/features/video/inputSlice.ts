import type { Input } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

// TODO: remove debug
const initialState: Input = {
  url: 'https://www.bilibili.com/video/BV1pJ411E7Eb',
  title: '',
  quality: '80',
}

export const inputSlice = createSlice({
  name: 'input',
  initialState,
  reducers: {
    setInput: (state, action: PayloadAction<Input>) => {
      return (state = action.payload)
    },
    setUrl: (state, action: PayloadAction<string>) => {
      state.url = action.payload
    },
    setTitle: (state, action: PayloadAction<string>) => {
      state.title = action.payload
    },
    setQuality: (state, action: PayloadAction<string>) => {
      state.quality = action.payload
    },
  },
})

export const { setInput, setUrl, setTitle, setQuality } = inputSlice.actions
export default inputSlice.reducer
