/**
 * sidebarSlice minimal roundtrip suite.
 *
 * The slice is a single boolean setter, so coverage is a toggle/restore
 * roundtrip against the real singleton store.
 */

import { store } from '@/app/store'
import { describe, expect, it } from 'vitest'

import { setSidebarOpen } from './sidebarSlice'

function sidebar() {
  return store.getState().sidebar
}

describe('sidebarSlice', () => {
  it('defaults to open', () => {
    expect(sidebar()).toEqual({ sidebarOpen: true })
  })

  it('closes and reopens via setSidebarOpen', () => {
    store.dispatch(setSidebarOpen(false))
    expect(sidebar().sidebarOpen).toBe(false)

    store.dispatch(setSidebarOpen(true))
    expect(sidebar().sidebarOpen).toBe(true)
  })
})
