/**
 * useInit suite.
 *
 * initApp reads the backend `initialize` / `get_init_result` commands via
 * mockInvoke and applies the frontend-specific bits (settings slice, font
 * size, sidebar, user slice, i18n language). The i18next singleton is the
 * centralized setup mock, so changeLanguage is observable as a vi.fn.
 */

import { store } from '@/app/store'
import { useInit, type InitResult } from '@/features/init/hooks/useInit'
import { setInitiated } from '@/features/init/model/initSlice'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke } from '@/test/test-utils'
import { exit } from '@tauri-apps/plugin-process'
import { renderHook } from '@testing-library/react'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const mockExit = exit as unknown as Mock
const mockChangeLanguage = i18next.changeLanguage as unknown as Mock

const baseline: Settings = {
  dlOutputPath: '',
  language: 'en',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const loggedInUser: User = {
  code: 0,
  message: '',
  ttl: 1,
  data: { uname: 'tester', isLogin: true, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: true,
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd]
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

describe('useInit', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baseline))
    store.dispatch(setInitiated(false))
    store.dispatch(setUser(loggedOutUser))
    document.documentElement.style.fontSize = ''
    vi.clearAllMocks()
  })

  it('applies settings, font size, sidebar, user, and language on success', async () => {
    const result: InitResult = {
      settings: {
        dlOutputPath: '/downloads',
        language: 'ja',
        fontSize: 16,
        sidebarExpanded: false,
      },
      user: loggedInUser,
      ffmpegSuccess: true,
    }
    mockCommands({
      get_os: 'macos',
      get_init_result: result,
    })
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    const code = await hook.current.initApp()

    expect(code).toEqual({ code: 0 })
    expect(mockInvoke).toHaveBeenCalledWith('initialize')
    expect(mockInvoke).toHaveBeenCalledWith('get_init_result')
    expect(store.getState().settings.dlOutputPath).toBe('/downloads')
    expect(document.documentElement.style.fontSize).toBe('16px')
    expect(store.getState().sidebar.sidebarOpen).toBe(false)
    expect(store.getState().user.data.uname).toBe('tester')
    expect(store.getState().init.initiated).toBe(true)
    expect(mockChangeLanguage).toHaveBeenCalledWith('ja')
  })

  it('does not change language when it already matches i18n', async () => {
    const result: InitResult = {
      settings: { ...baseline, language: 'en' },
      user: undefined,
      ffmpegSuccess: true,
    }
    mockCommands({ get_init_result: result })
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    // The mocked i18n reports language 'en', so no changeLanguage call.
    await hook.current.initApp()

    expect(mockChangeLanguage).not.toHaveBeenCalled()
  })

  it('returns code 1 when ffmpeg failed to validate', async () => {
    const result: InitResult = {
      settings: undefined,
      user: undefined,
      userError: 'ERR::UNAUTHORIZED',
      ffmpegSuccess: false,
    }
    mockCommands({ get_init_result: result })
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    const code = await hook.current.initApp()

    expect(code).toEqual({ code: 1 })
    // Still marked initiated, and the userError interception is skipped
    // (early return before interceptInvokeError).
    expect(store.getState().init.initiated).toBe(true)
  })

  it('falls back to defaults when get_init_result rejects', async () => {
    mockCommands({
      get_init_result: new Error('command not registered'),
    })
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    const code = await hook.current.initApp()

    expect(code).toEqual({ code: 1 })
    expect(store.getState().settings.dlOutputPath).toBe('')
    // parseFontSize(undefined) applies the 14px default.
    expect(document.documentElement.style.fontSize).toBe('14px')
    expect(store.getState().init.initiated).toBe(true)
    expect(store.getState().user.data.uname).toBe('')
  })

  it('intercepts a non-unauthorized userError and still returns code 0', async () => {
    const result: InitResult = {
      settings: undefined,
      user: undefined,
      userError: 'ERR::NETWORK',
      ffmpegSuccess: true,
    }
    mockCommands({ get_init_result: result })
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    const code = await hook.current.initApp()

    expect(code).toEqual({ code: 0 })
  })

  it('setInitiated dispatches to the init slice', () => {
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    hook.current.setInitiated(true)
    expect(store.getState().init.initiated).toBe(true)

    hook.current.setInitiated(false)
    expect(store.getState().init.initiated).toBe(false)
  })

  it('quitApp exits the process', async () => {
    const { result: hook } = renderHook(() => useInit(), { wrapper })

    await hook.current.quitApp()

    expect(mockExit).toHaveBeenCalledTimes(1)
  })
})
