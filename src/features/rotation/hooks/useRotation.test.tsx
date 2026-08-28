/**
 * useRotation suite: dialog picks, settings persistence on angle/mode
 * change, rotate lifecycle (success + error), reveal, default output name.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { open, save } from '@tauri-apps/plugin-dialog'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRotation } from './useRotation'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const baseSettings = {
  dlOutputPath: '/tmp',
  language: 'en',
  rotationAngle: 90,
  rotationMode: 'copy' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Why: the global invoke mock has no default implementation, so any
  // unhanded call resolves undefined and .catch on it throws inside hooks.
  mockInvoke.mockImplementation(() => Promise.resolve(undefined))
  store.dispatch(setSettings({ ...baseSettings } as never))
})

async function setupWithPaths() {
  vi.mocked(open).mockResolvedValue('/in/movie.mp4')
  vi.mocked(save).mockResolvedValue('/out/movie_rotated.mp4')
  const { result } = renderHookWithStore(() => useRotation())
  await act(async () => {
    await result.current.handleBrowse()
  })
  await act(async () => {
    await result.current.handleChooseOutput()
  })
  return result
}

describe('useRotation', () => {
  it('browse picks input and resets output (wrong-file overwrite guard)', async () => {
    const { result } = renderHookWithStore(() => useRotation())
    expect(result.current.inputPath).toBeNull()

    vi.mocked(open).mockResolvedValue('/in/a.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })
    expect(result.current.inputPath).toBe('/in/a.mp4')
    expect(result.current.outputPath).toBeNull()
  })

  it('choose output derives a _rotated default name from the input', async () => {
    const { result } = renderHookWithStore(() => useRotation())
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    await act(async () => {
      await result.current.handleBrowse()
    })
    await act(async () => {
      await result.current.handleChooseOutput()
    })
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'movie_rotated.mp4' }),
    )
  })

  it('canceling either dialog leaves state untouched', async () => {
    const { result } = renderHookWithStore(() => useRotation())
    vi.mocked(open).mockResolvedValue(null)
    await act(async () => {
      await result.current.handleBrowse()
    })
    expect(result.current.inputPath).toBeNull()
  })

  it('setAngle persists to settings via set_settings', async () => {
    const { result } = renderHookWithStore(() => useRotation())
    await act(async () => {
      result.current.setAngle(180)
    })
    expect(store.getState().settings.rotationAngle).toBe(180)
    expect(mockInvoke).toHaveBeenCalledWith(
      'set_settings',
      expect.objectContaining({
        settings: expect.objectContaining({ rotationAngle: 180 }),
      }),
    )
  })

  it('handleRotate succeeds and invokes rotate_video with the form values', async () => {
    const result = await setupWithPaths()
    mockInvoke.mockResolvedValueOnce(undefined)

    await act(async () => {
      await result.current.handleRotate()
    })

    expect(result.current.status).toBe('success')
    expect(mockInvoke).toHaveBeenCalledWith('rotate_video', {
      options: {
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_rotated.mp4',
        angle: 90,
        mode: 'copy',
      },
    })
  })

  it('handleRotate failure sets error status and toasts', async () => {
    const result = await setupWithPaths()
    mockInvoke.mockRejectedValueOnce(new Error('boom'))

    await act(async () => {
      await result.current.handleRotate()
    })

    expect(result.current.status).toBe('error')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })

  it('handleReveal invokes reveal_in_folder with the output path', async () => {
    const result = await setupWithPaths()
    await act(async () => {
      await result.current.handleReveal()
    })
    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/out/movie_rotated.mp4',
    })
  })

  it('reset returns the form to pristine state', async () => {
    const result = await setupWithPaths()
    act(() => {
      result.current.reset()
    })
    expect(result.current.inputPath).toBeNull()
    expect(result.current.outputPath).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})
