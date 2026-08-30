/**
 * useResolution suite.
 *
 * Covers the probe-to-preset flow (auto-select + custom bypass), output name
 * derivation, the convert lifecycle (success + mapped/raw errors), the
 * progress event wiring, reveal, and reset.
 */

import { toast } from '@/shared/ui/toast'
import {
  emitTauriEvent,
  mockInvoke,
  renderHookWithStore,
} from '@/test/test-utils'
import { open, save } from '@tauri-apps/plugin-dialog'
import { act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResolution } from './useResolution'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'probe_video_resolution')
      return Promise.resolve({ width: 1920, height: 1080 })
    if (cmd === 'extract_resolution')
      return Promise.resolve({ outputPath: '/out/x.mp4' })
    return Promise.resolve(undefined)
  })
})

/** Picks input + output through the dialog mocks (invoke mock from beforeEach). */
async function setupWithPaths() {
  vi.mocked(open).mockResolvedValue('/in/movie.mp4')
  vi.mocked(save).mockResolvedValue('/out/movie_resolution720.mp4')
  const { result } = renderHookWithStore(() => useResolution())
  await act(async () => {
    await result.current.handleBrowse()
  })
  await act(async () => {
    await result.current.handleChooseOutput()
  })
  return result
}

describe('useResolution input picking', () => {
  it('probes the source and auto-selects the best-effort preset', async () => {
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(mockInvoke).toHaveBeenCalledWith('probe_video_resolution', {
      inputPath: '/in/movie.mp4',
    })
    expect(result.current.inputResolution).toEqual({
      width: 1920,
      height: 1080,
    })
    // 1080p source: the largest preset that does not up-scale.
    expect(result.current.targetHeight).toBe(1080)
    expect(result.current.enabledResolutions).toContain(1080)
    expect(result.current.status).toBe('idle')
  })

  it('keeps the custom height when a new input is picked', async () => {
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    const { result } = renderHookWithStore(() => useResolution())
    act(() => {
      result.current.setIsCustomHeight(true)
      result.current.setTargetHeight(360)
    })

    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.isCustomHeight).toBe(true)
    expect(result.current.targetHeight).toBe(360)
  })

  it('enables every preset and keeps the default when the probe fails', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'probe_video_resolution') return Promise.resolve(null)
      return Promise.resolve(undefined)
    })
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.inputResolution).toBeNull()
    expect(result.current.targetHeight).toBe(720)
    expect(result.current.enabledResolutions).toEqual([1080, 720, 480, 360])
  })

  it('does nothing when the open dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleBrowse()
    })

    expect(result.current.inputPath).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'probe_video_resolution',
      expect.anything(),
    )
  })

  it('derives the _resolution<H> default output name from the input', async () => {
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    vi.mocked(save).mockResolvedValue('/out/movie_resolution1080.mp4')
    const { result } = renderHookWithStore(() => useResolution())
    await act(async () => {
      await result.current.handleBrowse()
    })

    await act(async () => {
      await result.current.handleChooseOutput()
    })

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'movie_resolution1080.mp4' }),
    )
    expect(result.current.outputPath).toBe('/out/movie_resolution1080.mp4')
  })

  it('choose output is a no-op without an input path', async () => {
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleChooseOutput()
    })

    expect(save).not.toHaveBeenCalled()
  })

  it('setTargetHeight clears the output path so the name is re-derived', async () => {
    const result = await setupWithPaths()
    expect(result.current.outputPath).not.toBeNull()

    act(() => {
      result.current.setTargetHeight(480)
    })

    expect(result.current.targetHeight).toBe(480)
    expect(result.current.outputPath).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})

describe('useResolution convert lifecycle', () => {
  it('invokes extract_resolution with the form values and reports success', async () => {
    const result = await setupWithPaths()
    vi.mocked(save).mockResolvedValue('/out/movie_resolution1080.mp4')
    await act(async () => {
      await result.current.handleChooseOutput()
    })

    await act(async () => {
      await result.current.handleConvert()
    })

    expect(mockInvoke).toHaveBeenCalledWith('extract_resolution', {
      options: {
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_resolution1080.mp4',
        targetHeight: 1080,
      },
    })
    expect(result.current.status).toBe('success')
    expect(result.current.progress).toMatchObject({ progress: 100 })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    const [, opts] = toastSuccess.mock.calls[0]
    // Success toast carries an Open folder action wired to handleReveal.
    expect(opts.action.label).toBe('resolution.openFolder')
  })

  it('maps a known ERR::RESOLUTION code to its translation key', async () => {
    const result = await setupWithPaths()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'probe_video_resolution')
        return Promise.resolve({ width: 1920, height: 1080 })
      return Promise.reject(new Error('ERR::RESOLUTION_SAME_PATH'))
    })

    await act(async () => {
      await result.current.handleConvert()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.progress).toBeNull()
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][1].description).toBe(
      'resolution.error.same_path',
    )
  })

  it('keeps the raw message for an unknown error', async () => {
    const result = await setupWithPaths()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'probe_video_resolution')
        return Promise.resolve({ width: 1920, height: 1080 })
      return Promise.reject(new Error('ffmpeg exploded'))
    })

    await act(async () => {
      await result.current.handleConvert()
    })

    expect(toastError.mock.calls[0][1].description).toBe('ffmpeg exploded')
  })

  it('is a no-op until both paths are chosen', async () => {
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleConvert()
    })

    expect(mockInvoke).not.toHaveBeenCalledWith(
      'extract_resolution',
      expect.anything(),
    )
    expect(result.current.status).toBe('idle')
  })

  it('stores the latest resolution://progress payload', async () => {
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await emitTauriEvent('resolution://progress', {
        progress: 50,
        currentTimeSec: 10,
        totalDurationSec: 20,
      })
    })

    expect(result.current.progress).toEqual({
      progress: 50,
      currentTimeSec: 10,
      totalDurationSec: 20,
    })
    // progress > 1 while idle: elapsed is 0, so remaining is 0.
    expect(result.current.remainingSec).toBe(0)
  })

  it('reveals the output folder through reveal_in_folder', async () => {
    const result = await setupWithPaths()

    await act(async () => {
      await result.current.handleReveal()
    })

    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/out/movie_resolution720.mp4',
    })
  })

  it('reveal is a no-op without an output path', async () => {
    const { result } = renderHookWithStore(() => useResolution())

    await act(async () => {
      await result.current.handleReveal()
    })

    expect(mockInvoke).not.toHaveBeenCalledWith(
      'reveal_in_folder',
      expect.anything(),
    )
  })

  it('reset returns the hook to its pristine state', async () => {
    const result = await setupWithPaths()

    act(() => {
      result.current.reset()
    })

    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.targetHeight).toBe(720)
    expect(result.current.isCustomHeight).toBe(false)
    expect(result.current.inputResolution).toBeNull()
    expect(result.current.status).toBe('idle')
    expect(result.current.progress).toBeNull()
  })
})
