/**
 * useConcat suite: file add/remove/reorder, client-side validation gates,
 * concat lifecycle (success + fallback toast + progress events), reveal.
 */

import { toast } from '@/shared/ui/toast'
import { emitTauriEvent } from '@/test/tauriEvents'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { open, save } from '@tauri-apps/plugin-dialog'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConcat } from './useConcat'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(() => Promise.resolve(undefined))
})

async function addFiles(paths: string[]) {
  vi.mocked(open).mockResolvedValue(paths)
  const { result } = renderHookWithStore(() => useConcat())
  await act(async () => {
    await result.current.handleAddFiles()
  })
  return result
}

async function setupValid() {
  const result = await addFiles(['/a.mp4', '/b.mp4'])
  vi.mocked(save).mockResolvedValue('/out/concat.mp4')
  await act(async () => {
    await result.current.handleChooseOutput()
  })
  return result
}

describe('useConcat file management', () => {
  it('adds selected files and keeps existing ones', async () => {
    const result = await addFiles(['/a.mp4'])
    vi.mocked(open).mockResolvedValue(['/b.mp4'])
    await act(async () => {
      await result.current.handleAddFiles()
    })
    expect(result.current.files).toEqual(['/a.mp4', '/b.mp4'])
  })

  it('canceling the dialog leaves files unchanged', async () => {
    const result = await addFiles(['/a.mp4'])
    vi.mocked(open).mockResolvedValue(null)
    await act(async () => {
      await result.current.handleAddFiles()
    })
    expect(result.current.files).toEqual(['/a.mp4'])
  })

  it('removes and reorders files', async () => {
    const result = await addFiles(['/a.mp4', '/b.mp4', '/c.mp4'])
    act(() => {
      result.current.handleRemoveFile(1)
    })
    expect(result.current.files).toEqual(['/a.mp4', '/c.mp4'])
    act(() => {
      result.current.handleReorderFiles(1, 0)
    })
    expect(result.current.files).toEqual(['/c.mp4', '/a.mp4'])
  })
})

describe('handleConcat validation gates', () => {
  it('rejects with no files', async () => {
    const result = renderHookWithStore(() => useConcat()).result
    await act(async () => {
      await result.current.handleConcat()
    })
    expect(result.current.validationError).toBe('no_files')
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'concat_videos',
      expect.anything(),
    )
  })

  it('rejects with a single file', async () => {
    const result = await addFiles(['/a.mp4'])
    await act(async () => {
      await result.current.handleConcat()
    })
    expect(result.current.validationError).toBe('single_file')
  })

  it('rejects duplicate paths', async () => {
    const result = await addFiles(['/a.mp4', '/a.mp4'])
    await act(async () => {
      await result.current.handleConcat()
    })
    expect(result.current.validationError).toBe('duplicate_paths')
  })
})

describe('handleConcat lifecycle', () => {
  it('concatenates with the file list and output path', async () => {
    const result = await setupValid()
    await act(async () => {
      await result.current.handleConcat()
    })
    expect(result.current.status).toBe('success')
    expect(mockInvoke).toHaveBeenCalledWith('concat_videos', {
      options: {
        inputPaths: ['/a.mp4', '/b.mp4'],
        outputPath: '/out/concat.mp4',
      },
    })
    expect(toast.success).toHaveBeenCalledWith(
      'concat.success',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'concat.openFolder' }),
      }),
    )
  })

  it('failure sets error status and maps the message', async () => {
    const result = await setupValid()
    mockInvoke.mockRejectedValueOnce('ERR::SOME_FAILURE')
    await act(async () => {
      await result.current.handleConcat()
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(toast.error).toHaveBeenCalledWith(
      'concat.failed',
      expect.objectContaining({ description: expect.any(String) }),
    )
  })

  it('concat://progress events update progress', async () => {
    const result = await setupValid()
    act(() => {
      emitTauriEvent('concat://progress', {
        progress: 50,
        currentTimeSec: 5,
        totalDurationSec: 10,
      })
    })
    await waitFor(() => expect(result.current.progress?.progress).toBe(50))
  })

  it('concat://fallback resets progress and toasts the notice', async () => {
    const result = await setupValid()
    act(() => {
      emitTauriEvent('concat://fallback', undefined)
    })
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('concat.fallbackNotice'),
    )
    expect(result.current.progress).toBeNull()
  })
})

describe('misc', () => {
  it('handleReveal invokes reveal_in_folder', async () => {
    const result = await setupValid()
    await act(async () => {
      await result.current.handleReveal()
    })
    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/out/concat.mp4',
    })
  })

  it('reset clears everything', async () => {
    const result = await setupValid()
    act(() => {
      result.current.reset()
    })
    expect(result.current.files).toEqual([])
    expect(result.current.outputPath).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})
