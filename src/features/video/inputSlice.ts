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
        {
          cid: number
          page: number
          title: string
          videoQuality: string
          audioQuality: string
          selected: boolean
        }[]
      >,
    ) => {
      // 既存互換: legacy quality を持つ要素が来た場合のガードは呼び出し側で保証する前提
      state.partInputs = action.payload
    },
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
    updatePartSelected: (
      state,
      action: PayloadAction<{ index: number; selected: boolean }>,
    ) => {
      const { index, selected } = action.payload
      const target = state.partInputs[index]
      if (target) target.selected = selected
    },
    selectAll: (state) => {
      state.partInputs.forEach((p) => {
        p.selected = true
      })
    },
    deselectAll: (state) => {
      state.partInputs.forEach((p) => {
        p.selected = false
      })
    },
  },
})

export const {
  setInput,
  setUrl,
  initPartInputs,
  updatePartInputByIndex,
  updatePartSelected,
  selectAll,
  deselectAll,
} = inputSlice.actions
export default inputSlice.reducer
