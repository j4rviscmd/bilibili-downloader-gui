import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * Sidebar state management
 *
 * Redux state that manages the sidebar open/close state.
 * This state is persisted in settings.json and maintained across page transitions.
 */
export type SidebarState = {
  /** Whether the sidebar is open */
  sidebarOpen: boolean
}

const initialState: SidebarState = {
  sidebarOpen: true,
}

/**
 * Redux Slice for sidebar
 *
 * Manages the sidebar open/close state. State is defined using
 * Redux Toolkit's createSlice and updated via the setSidebarOpen action.
 */
export const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    /**
     * Sets the sidebar open/close state
     *
     * @param state - Current Redux state
     * @param action - Action containing a boolean value (true: open, false: close)
     */
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload
    },
  },
})

export const { setSidebarOpen } = sidebarSlice.actions
export default sidebarSlice.reducer
