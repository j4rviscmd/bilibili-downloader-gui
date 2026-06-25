import { store } from '@/app/store'
import { useFontSizeShortcuts } from '@/features/settings/hooks/useFontSizeShortcuts'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { invoke } from '@tauri-apps/api/core'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture toast.info calls so we can assert the feedback payload.
const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfo(...args) },
}))

// i18next is not initialized in unit tests; stub `t` (and the default
// `i18n` instance used by `@/i18n`) so we can assert the toast message
// shape without booting the full i18n pipeline.
vi.mock('i18next', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    opts && typeof opts.size === 'number' ? `${key}:${opts.size}` : key
  return {
    t,
    default: { t, language: 'en' },
  }
})

// invoke is already mocked globally by src/test/setup.ts.
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>

const baselineSettings: Settings = {
  dlOutputPath: '',
  language: 'en',
  autoRenameDuplicates: true,
  showGithubStars: true,
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  window.dispatchEvent(event)
  return { event, preventDefault }
}

describe('useFontSizeShortcuts', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baselineSettings))
    document.documentElement.style.fontSize = ''
    mockInvoke.mockClear()
    toastInfo.mockClear()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('increases font size on Ctrl+= and persists', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('=', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(15)
    expect(document.documentElement.style.fontSize).toBe('15px')
    expect(mockInvoke).toHaveBeenCalledWith(
      'set_settings',
      expect.objectContaining({
        settings: expect.objectContaining({ fontSize: 15 }),
      }),
    )
    expect(toastInfo).toHaveBeenCalledWith(
      'settings.font_size_changed:15',
      expect.objectContaining({ id: 'font-size-shortcut' }),
    )
  })

  it('treats Ctrl++ (shifted) the same as Ctrl+=', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('+', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(15)
  })

  it('decreases font size on Ctrl+-', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('-', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(13)
    expect(document.documentElement.style.fontSize).toBe('13px')
  })

  it('accepts Cmd (metaKey) on macOS', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('+', { metaKey: true })
    expect(store.getState().settings.fontSize).toBe(15)
  })

  it('clamps at MAX, shows the boundary toast, but skips persisting', () => {
    store.dispatch(setSettings({ ...baselineSettings, fontSize: 20 }))
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('+', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(20)
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(toastInfo).toHaveBeenCalledWith(
      'settings.font_size_changed:20',
      expect.objectContaining({ id: 'font-size-shortcut' }),
    )
  })

  it('clamps at MIN without persisting', () => {
    store.dispatch(setSettings({ ...baselineSettings, fontSize: 12 }))
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('-', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(12)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('ignores keys without a modifier', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    press('+')
    press('-')
    expect(store.getState().settings.fontSize).toBe(14)
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('calls preventDefault to suppress native webview zoom', () => {
    renderHook(() => useFontSizeShortcuts(), { wrapper })
    const { preventDefault } = press('+', { ctrlKey: true })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('detaches the listener on unmount', () => {
    const { unmount } = renderHook(() => useFontSizeShortcuts(), { wrapper })
    unmount()
    press('+', { ctrlKey: true })
    expect(store.getState().settings.fontSize).toBe(14)
  })
})
