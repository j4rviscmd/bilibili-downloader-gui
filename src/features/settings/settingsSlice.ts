import type { Settings } from '@/features/settings/type'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * Extended settings state including UI dialog open state.
 */
type SettingsState = Settings & {
  /** Whether the settings dialog is currently open */
  dialogOpen: boolean
}

const initialState: SettingsState = {
  dlOutputPath: '',
  language: 'en',
  dialogOpen: false,
}

/**
 * Redux slice for application settings management.
 *
 * Manages user preferences including download output path, language,
 * and the settings dialog open/close state. Settings are persisted
 * to the backend via API calls (not handled by this slice directly).
 */
export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    /**
     * Updates the download output directory path.
     *
     * @param state - Current settings state
     * @param action - Action containing the new path
     */
    setDLOutputPath: (state, action: PayloadAction<string>) => {
      state.dlOutputPath = action.payload
    },
    /**
     * Sets the settings dialog open/close state.
     *
     * @param state - Current settings state
     * @param action - Action containing the new dialog state
     */
    setOpenDialog: (state, action: PayloadAction<boolean>) => {
      state.dialogOpen = action.payload
    },
    /**
     * Updates all settings from a full settings object.
     *
     * Merges the provided settings with the current state,
     * preserving the dialogOpen state.
     *
     * @param state - Current settings state
     * @param action - Action containing the new settings
     */
    setSettings: (state, action: PayloadAction<Settings>) => {
      return { ...state, ...action.payload }
    },
  },
})

export const { setSettings, setOpenDialog, setDLOutputPath } =
  settingsSlice.actions
export default settingsSlice.reducer
