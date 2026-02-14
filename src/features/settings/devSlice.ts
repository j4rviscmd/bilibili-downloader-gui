import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface DevState {
  simulateLogout: boolean
}

const initialState: DevState = {
  simulateLogout: false,
}

const devSlice = createSlice({
  name: 'dev',
  initialState,
  reducers: {
    setSimulateLogout(state, action: PayloadAction<boolean>) {
      state.simulateLogout = action.payload
    },
  },
})

export const { setSimulateLogout } = devSlice.actions
export default devSlice.reducer
