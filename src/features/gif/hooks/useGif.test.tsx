/**
 * useGif suite.
 *
 * Local-state tool hook: dialog picks via the setup plugin-dialog mocks,
 * the generate_animation / probe_video_resolution / patch_settings /
 * reveal_in_folder commands via mockInvoke, progress via emitTauriEvent,
 * and toasts via a local spy (identity t).
 */

import { store } from '@/app/store'
import { useGif } from '@/features/gif/hooks/useGif'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
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
  gifFormat: 'gif',
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

/** Picks an input and output so handleGenerate can run. */
async function pickPaths(
  hook: { current: ReturnType<typeof useGif> },
  input = '/x/movie.mp4',
  output = '/o/out.gif',
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

describe('useGif', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baseline))
    clearTauriEvents()
    vi.clearAllMocks()
    mockCommands({})
  })

  it('starts idle with no paths, defaulting to gif/480/15', () => {
    const { result } = renderHook(() => useGif(), { wrapper })

    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.format).toBe('gif')
    expect(result.current.widthPreset).toBe('480')
    expect(result.current.fps).toBe('15')
    expect(result.current.status).toBe('idle')
    expect(result.current.rangeError).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it('rejects a generation without a range (empty_start) without invoking', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(result.current.rangeError).toBe('empty_start')
    expect(result.current.status).toBe('idle')
    expect(mockInvoke).not.toHaveBeenCalledWith('generate_animation')
  })

  it('rejects an inverted range (end_before_start)', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:10')
      result.current.setEnd('00:00:05')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(result.current.rangeError).toBe('end_before_start')
    expect(mockInvoke).not.toHaveBeenCalledWith('generate_animation')
  })

  it('browse sets the input, probes the source width, and resets the output', async () => {
    mockCommands({ probe_video_resolution: { width: 1920, height: 1080 } })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)
    expect(result.current.outputPath).toBe('/o/out.gif')
    expect(result.current.sourceWidth).toBe(1920)

    mockOpen.mockResolvedValueOnce('/x/other.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.inputPath).toBe('/x/other.mp4')
    expect(result.current.outputPath).toBeNull()
  })

  it('keeps sourceWidth null when the probe fails', async () => {
    mockCommands({
      probe_video_resolution: new Error('probe failed'),
    })
    const { result } = renderHook(() => useGif(), { wrapper })

    mockOpen.mockResolvedValueOnce('/x/movie.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.inputPath).toBe('/x/movie.mp4')
    expect(result.current.sourceWidth).toBeNull()
  })

  it('offers a *_clip.gif default name in the save dialog', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'movie_clip.gif' }),
    )
    expect(result.current.outputPath).toBe('/o/out.gif')
  })

  it('generates successfully with parsed timecodes and toasts', async () => {
    mockCommands({ generate_animation: { outputPath: '/o/out.gif' } })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:01')
      result.current.setEnd('00:00:10')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(mockInvoke).toHaveBeenCalledWith('generate_animation', {
      options: {
        inputPath: '/x/movie.mp4',
        outputPath: '/o/out.gif',
        startTime: 1,
        endTime: 10,
        format: 'gif',
        width: 480,
        fps: 15,
      },
    })
    expect(result.current.status).toBe('success')
    expect(result.current.rangeError).toBeNull()
    expect(result.current.progress?.progress).toBe(100)
    expect(result.current.remainingSec).toBe(0)
    expect(toastSuccess).toHaveBeenCalledWith(
      'gif.success',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'gif.openFolder' }),
      }),
    )
  })

  it('sends width null for the original preset', async () => {
    mockCommands({ generate_animation: { outputPath: '/o/out.gif' } })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setWidthPreset('original')
      result.current.setStart('00:00:01')
      result.current.setEnd('00:00:10')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(mockInvoke).toHaveBeenCalledWith('generate_animation', {
      options: expect.objectContaining({ width: null }),
    })
  })

  it('maps ERR::GIF_SAME_PATH to a localized description', async () => {
    mockCommands({ generate_animation: new Error('ERR::GIF_SAME_PATH') })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setStart('00:00:01')
      result.current.setEnd('00:00:02')
    })
    await act(async () => {
      await result.current.handleGenerate()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.progress).toBeNull()
    expect(toastError).toHaveBeenCalledWith('gif.failed', {
      description: 'gif.error.same_path',
    })
  })

  it('setFormat persists to the settings slice and backend, and swaps the output extension', async () => {
    mockCommands({ patch_settings: undefined })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result, '/x/movie.mp4', '/o/out.gif')
    expect(result.current.outputPath).toBe('/o/out.gif')

    act(() => {
      result.current.setFormat('webm')
    })

    expect(result.current.format).toBe('webm')
    expect(result.current.outputPath).toBe('/o/out.webm')
    expect(store.getState().settings.gifFormat).toBe('webm')
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
        patch: { gifFormat: 'webm' },
      })
    })
  })

  it('syncs the local format when settings change externally', () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    expect(result.current.format).toBe('gif')

    act(() => {
      store.dispatch(setSettings({ ...baseline, gifFormat: 'webm' }))
    })

    expect(result.current.format).toBe('webm')
  })

  it('updates progress from the gif://progress event while mounted', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    // Let the async listen() registration settle first.
    await act(async () => {})

    act(() => {
      emitTauriEvent('gif://progress', {
        progress: 40,
        currentTimeSec: 4,
        totalDurationSec: 10,
      })
    })

    expect(result.current.progress?.progress).toBe(40)
  })

  it('reveal invokes reveal_in_folder with the output path', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    await act(async () => {
      await result.current.handleReveal()
    })

    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/o/out.gif',
    })
  })

  it('reset clears paths, range, and progress', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.reset()
    })

    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.start).toBe('')
    expect(result.current.end).toBe('')
    expect(result.current.widthPreset).toBe('480')
    expect(result.current.status).toBe('idle')
    expect(result.current.progress).toBeNull()
  })

  it('offers a *_clip.gif default name for an extension-less input', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    mockOpen.mockResolvedValueOnce('/x/movie')
    await act(async () => {
      await result.current.handleBrowse()
    })

    mockSave.mockResolvedValueOnce('/o/out.gif')
    await act(async () => {
      await result.current.handleChooseOutput()
    })

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'movie_clip.gif' }),
    )
  })

  it('setFormat appends the extension when the picked output has none', async () => {
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result, '/x/movie.mp4', '/o/out-noext')

    act(() => {
      result.current.setFormat('webm')
    })

    expect(result.current.outputPath).toBe('/o/out-noext.webm')
  })

  it('reveal swallows a backend error instead of rejecting', async () => {
    mockCommands({ reveal_in_folder: new Error('opener failed') })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    // Must resolve (error is logged, not thrown)
    await act(async () => {
      await result.current.handleReveal()
    })
  })

  it('setFormat still updates locally when patch_settings fails', async () => {
    mockCommands({ patch_settings: new Error('disk full') })
    const { result } = renderHook(() => useGif(), { wrapper })
    await pickPaths(result)

    act(() => {
      result.current.setFormat('webm')
    })

    expect(result.current.format).toBe('webm')
    expect(store.getState().settings.gifFormat).toBe('webm')
  })
})
