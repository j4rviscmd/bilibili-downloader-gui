import type { Input } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Input = {
  url: '',
  partInputs: [],
}

export const inputSlice = createSlice({
  name: 'input',
  initialState,
  reducers: {
    setInput: (_, action: PayloadAction<Input>) => {
      return action.payload
    },
    setUrl: (state, action: PayloadAction<string>) => {
      state.url = action.payload
    },
    initPartInputs: (
      state,
      action: PayloadAction<
        { cid: number; page: number; title: string; quality: string }[]
      >,
    ) => {
      state.partInputs = action.payload
    },
    updatePartInputByIndex: (
      state,
      action: PayloadAction<{
        index: number
        title?: string
        quality?: string
      }>,
    ) => {
      const { index, title, quality } = action.payload
      const target = state.partInputs[index]
      if (!target) return
      if (title !== undefined) target.title = title
      if (quality !== undefined) target.quality = quality
    },
  },
})

export const { setInput, setUrl, initPartInputs, updatePartInputByIndex } =
  inputSlice.actions
export default inputSlice.reducer
