import { FONT_SIZE_DEFAULT } from '@/features/settings/lib/fontSize'
import type { Settings } from '@/features/settings/type'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * Redux slice for application settings management.
 *
 * Manages user preferences including download output path, language,
 * and theme. Settings are persisted to the backend via API calls (not
 * handled by this slice directly).
 */
const initialState: Settings = {
  dlOutputPath: '',
  language: 'en',
  autoRenameDuplicates: true,
  omitDuplicatePartTitle: true,
  showGithubStars: true,
  fontSize: FONT_SIZE_DEFAULT,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
  showTaskbarProgress: true,
  flashTaskbarOnComplete: true,
  videoCodecPriority: 'av1First',
  // Note: must match the backend default in Settings::resolve_segment_concurrency
  //   (8) so the initial UI selection agrees with the resolved concurrency
  //   before the persisted setting is loaded (issue #491).
  downloadParallelism: 8,
  // Issue #421: unlimited by default (backend resolve returns 0 when the
  // switch is off, so the kbps seed only feeds the input's initial draft).
  downloadSpeedLimitEnabled: false,
  downloadSpeedLimitKbps: 1000,
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    /**
     * Applies a partial settings update (field patch, issue #563).
     *
     * Merges the patched fields with the current state, preserving
     * untouched fields.
     *
     * @param state - Current settings state
     * @param action - Action containing the settings patch
     */
    setSettings: (state, action: PayloadAction<Partial<Settings>>) => {
      return { ...state, ...action.payload }
    },
  },
})

export const { setSettings } = settingsSlice.actions
export default settingsSlice.reducer
