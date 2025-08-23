import type { Settings } from '@/shared/settings/type'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Settings = {
  language: 'en',
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setSettings: (_, action: PayloadAction<Settings>) => {
      return action.payload
    },
  },
})

export const { setSettings } = settingsSlice.actions
export default settingsSlice.reducer
