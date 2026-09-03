/**
 * useTrim suite.
 *
 * Local-state tool hook: dialog picks via the setup plugin-dialog mocks,
 * the trim_video / set_settings / reveal_in_folder commands via mockInvoke,
 * progress via emitTauriEvent, and toasts via a local spy (identity t).
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { useTrim } from '@/features/trim/hooks/useTrim'
import { toast } from '@/shared/ui/toast'
import { clearTauriEvents, emitTauriEvent, mockInvoke } from '@/test/test-utils'
import { open, save } from '@tauri-apps/plugin-dialog'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock
const mockOpen = open as unknown as Mock
const mockSave = save as unknown as Mock

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

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd]
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

/** Picks an input and output so handleTrim can run. */
async function pickPaths(
  hook: { current: ReturnType<typeof useTrim> },
  input = '/x/movie.mp4',
  output = '/o/out.mp4',
) {
  mockOpen.mockResolvedValueOnce(input)
  await act(async () => {
    await hook.current.handleBrowse()
  })
  mockSave.mockResolvedValueOnce(output)
  await act(async () => {
    await hook.current.handleChooseOutput()
  })
}

describe('useTrim', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baseline))
    clearTauriEvents()
    vi.clearAllMocks()
    mockCommands({})
  })

  it('starts idle with no paths and no range error', () => {
    const { result } = renderHook(() => useTrim(), { wrapper })

    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(result.current.rangeError).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it('rejects a trim with no range (both_empty) without invoking', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    await act(async () => {
      await result.current.handleTrim()
    })

    expect(result.current.rangeError).toBe('both_empty')
    expect(result.current.status).toBe('idle')
    expect(mockInvoke).not.toHaveBeenCalledWith('trim_video')
  })

  it('rejects an inverted range (end_before_start)', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:10')
      result.current.setEnd('00:00:05')
    })
    await act(async () => {
      await result.current.handleTrim()
    })

    expect(result.current.rangeError).toBe('end_before_start')
    expect(mockInvoke).not.toHaveBeenCalledWith('trim_video')
  })

  it('browse sets the input and resets a previously chosen output', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)
    expect(result.current.outputPath).toBe('/o/out.mp4')

    mockOpen.mockResolvedValueOnce('/x/other.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.inputPath).toBe('/x/other.mp4')
    expect(result.current.outputPath).toBeNull()
  })

  it('offers a *_trimmed.mp4 default name in the save dialog', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    mockOpen.mockResolvedValueOnce('/x/movie.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })

    mockSave.mockResolvedValueOnce('/o/out.mp4')
    await act(async () => {
      await result.current.handleChooseOutput()
    })

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'movie_trimmed.mp4' }),
    )
    expect(result.current.outputPath).toBe('/o/out.mp4')
  })

  it('trims successfully with parsed timecodes and toasts', async () => {
    mockCommands({ trim_video: { outputPath: '/o/out.mp4' } })
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:01')
      result.current.setEnd('00:00:10')
    })
    await act(async () => {
      await result.current.handleTrim()
    })

    expect(mockInvoke).toHaveBeenCalledWith('trim_video', {
      options: {
        inputPath: '/x/movie.mp4',
        outputPath: '/o/out.mp4',
        startTime: 1,
        endTime: 10,
        mode: 'copy',
      },
    })
    expect(result.current.status).toBe('success')
    expect(result.current.rangeError).toBeNull()
    expect(result.current.progress?.progress).toBe(100)
    expect(result.current.remainingSec).toBe(0)
    expect(toastSuccess).toHaveBeenCalledWith(
      'trim.success',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'trim.openFolder' }),
      }),
    )
  })

  it('maps ERR::TRIM_SAME_PATH to a localized description', async () => {
    mockCommands({ trim_video: new Error('ERR::TRIM_SAME_PATH') })
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:01')
    })
    await act(async () => {
      await result.current.handleTrim()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.progress).toBeNull()
    expect(toastError).toHaveBeenCalledWith('trim.failed', {
      description: 'trim.error.same_path',
    })
  })

  it('setMode persists to the settings slice and backend', async () => {
    mockCommands({ patch_settings: undefined })
    const { result } = renderHook(() => useTrim(), { wrapper })

    act(() => {
      result.current.setMode('reencode')
    })

    expect(result.current.mode).toBe('reencode')
    expect(store.getState().settings.trimMode).toBe('reencode')
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
        patch: { trimMode: 'reencode' },
      })
    })
  })

  it('syncs the local mode when settings change externally', () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    expect(result.current.mode).toBe('copy')

    act(() => {
      store.dispatch(setSettings({ ...baseline, trimMode: 'reencode' }))
    })

    expect(result.current.mode).toBe('reencode')
  })

  it('updates progress from the trim://progress event while mounted', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    // Let the async listen() registration settle first.
    await act(async () => {})

    act(() => {
      emitTauriEvent('trim://progress', {
        progress: 40,
        currentTimeSec: 4,
        totalDurationSec: 10,
      })
    })

    expect(result.current.progress?.progress).toBe(40)
  })

  it('reveal invokes reveal_in_folder with the output path', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    await act(async () => {
      await result.current.handleReveal()
    })

    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/o/out.mp4',
    })
  })

  it('reset clears paths, range, and progress', async () => {
    const { result } = renderHook(() => useTrim(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.reset()
    })

    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.start).toBe('')
    expect(result.current.end).toBe('')
    expect(result.current.mode).toBe('copy')
    expect(result.current.status).toBe('idle')
    expect(result.current.progress).toBeNull()
  })
})
