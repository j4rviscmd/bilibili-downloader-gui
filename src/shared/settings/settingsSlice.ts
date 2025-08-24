import type { Settings } from '@/shared/settings/type'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

type SettingsState = Settings & {
  dialogOpen: boolean
}
const initialState: SettingsState = {
  language: 'en',
  dialogOpen: false,
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setOpenDialog: (state, action: PayloadAction<boolean>) => {
      state.dialogOpen = action.payload
    },
    setSettings: (state, action: PayloadAction<Settings>) => {
      return (state = { ...state, ...action.payload })
    },
  },
})

export const { setSettings, setOpenDialog } = settingsSlice.actions
export default settingsSlice.reducer
