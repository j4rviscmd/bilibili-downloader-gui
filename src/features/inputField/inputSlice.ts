import type { Input } from '@/features/inputField/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Input = { url: '' }

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
