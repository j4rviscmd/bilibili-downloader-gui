/**
 * Sidebar feature - Public API
 *
 * Manages sidebar state using Redux to persist the open/closed state
 * across page navigations.
 */

export { setSidebarOpen, default as sidebarReducer } from './model/sidebarSlice'
export type { SidebarState } from './model/sidebarSlice'
