import type { RootState } from '@/app/store'
import type { CountState } from '@/features/count/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: CountState = { value: 0 }

export const countSlice = createSlice({
  name: 'count',
  initialState,
  reducers: {
    increment(state) {
      state.value += 1
    },
    decrement(state) {
      state.value -= 1
    },
    setCount(state, action: PayloadAction<number>) {
      state.value = action.payload
    },
  },
})

export const { increment, decrement, setCount } = countSlice.actions

export const selectCount = (state: RootState) => state.count.value

export default countSlice.reducer
