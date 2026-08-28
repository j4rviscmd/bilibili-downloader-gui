/**
 * useThemeEffect suite.
 *
 * The hook maps the settings.theme slice onto the document root (class,
 * colorScheme, localStorage) and the native window theme via the shared
 * setup.ts window mock.
 */

import { store } from '@/app/store'
import { useThemeEffect } from '@/features/settings/hooks/useThemeEffect'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// setup.ts returns a single shared window instance, so this is the same
// vi.fn the hook invokes.
const mockSetTheme = getCurrentWindow().setTheme as unknown as ReturnType<
  typeof vi.fn
>

const baseline: Settings = {
  dlOutputPath: '',
  language: 'en',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

const root = () => window.document.documentElement

describe('useThemeEffect', () => {
  beforeEach(() => {
    root().classList.remove('light', 'dark')
    root().style.colorScheme = ''
    window.localStorage.removeItem('ui-theme')
    vi.clearAllMocks()
  })

  afterEach(() => {
    root().classList.remove('light', 'dark')
  })

  it('applies the light theme class, colorScheme, storage, and native theme', () => {
    store.dispatch(setSettings(baseline))
    renderHook(() => useThemeEffect(), { wrapper })

    expect(root().classList.contains('light')).toBe(true)
    expect(root().classList.contains('dark')).toBe(false)
    expect(root().style.colorScheme).toBe('light')
    expect(window.localStorage.getItem('ui-theme')).toBe('light')
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('applies dark when settings.theme is dark', () => {
    store.dispatch(setSettings({ ...baseline, theme: 'dark' }))
    renderHook(() => useThemeEffect(), { wrapper })

    expect(root().classList.contains('dark')).toBe(true)
    expect(root().classList.contains('light')).toBe(false)
    expect(root().style.colorScheme).toBe('dark')
    expect(window.localStorage.getItem('ui-theme')).toBe('dark')
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('swaps the class when the theme changes while mounted', () => {
    store.dispatch(setSettings(baseline))
    const { rerender } = renderHook(() => useThemeEffect(), { wrapper })
    expect(root().classList.contains('light')).toBe(true)

    store.dispatch(setSettings({ ...baseline, theme: 'dark' }))
    rerender()

    expect(root().classList.contains('dark')).toBe(true)
    expect(root().classList.contains('light')).toBe(false)
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('falls back to light when theme is undefined', () => {
    store.dispatch(setSettings({ ...baseline, theme: undefined }))
    renderHook(() => useThemeEffect(), { wrapper })

    expect(root().classList.contains('light')).toBe(true)
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })
})
