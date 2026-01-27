import type { RootState } from '@/app/store'
import type { CountState } from '@/features/count/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: CountState = { value: 0 }

/**
 * Redux slice for counter state management.
 *
 * Provides actions to increment, decrement, or set an absolute value.
 * Used for demonstration purposes.
 */
export const countSlice = createSlice({
  name: 'count',
  initialState,
  reducers: {
    /**
     * Increments the counter by 1.
     *
     * @param state - Current counter state
     */
    increment(state) {
      state.value += 1
    },
    /**
     * Decrements the counter by 1.
     *
     * @param state - Current counter state
     */
    decrement(state) {
      state.value -= 1
    },
    /**
     * Sets the counter to a specific value.
     *
     * @param state - Current counter state
     * @param action - Action containing the new value
     */
    setCount(state, action: PayloadAction<number>) {
      state.value = action.payload
    },
  },
})

export const { increment, decrement, setCount } = countSlice.actions

/**
 * Selector to get the current count value from the Redux store.
 *
 * @param state - Root Redux state
 * @returns Current counter value
 */
export const selectCount = (state: RootState) => state.count.value

export default countSlice.reducer
