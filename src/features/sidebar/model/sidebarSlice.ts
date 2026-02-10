import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const COOKIE_NAME = 'sidebar_state'

/**
 * Reads the initial sidebar state from browser cookies.
 *
 * Falls back to true (open) if document is unavailable (SSR) or
 * cookie is not set/invalid.
 *
 * @returns The initial open state of the sidebar
 */
function readInitialState(): boolean {
  if (typeof document === 'undefined') return true

  const match =
    document.cookie
      .split(';')
      .find((c) => c.trim().startsWith(`${COOKIE_NAME}=`))
      ?.split('=')[1]
      ?.trim() ?? ''

  return match === 'true'
}

/** Sidebar state shape managed by Redux. */
export type SidebarState = {
  sidebarOpen: boolean
}

const initialState: SidebarState = {
  sidebarOpen: readInitialState(),
}

/**
 * Redux slice for managing sidebar open/closed state.
 *
 * Provides action creator to update sidebar state. The state is
 * persisted via cookies by the SidebarProvider component.
 *
 * @example
 * ```ts
 * import { setSidebarOpen } from '@/features/sidebar'
 * dispatch(setSidebarOpen(true))
 * ```
 */
export const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload
    },
  },
})

export const { setSidebarOpen } = sidebarSlice.actions
export default sidebarSlice.reducer
