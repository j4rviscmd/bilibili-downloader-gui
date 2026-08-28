/**
 * useAudio suite: probe-driven bitrate auto-select, format persistence,
 * extract lifecycle, progress event via the in-memory bus, reveal, reset.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { toast } from '@/shared/ui/toast'
import { emitTauriEvent } from '@/test/tauriEvents'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { open, save } from '@tauri-apps/plugin-dialog'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAudio } from './useAudio'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Why: the global invoke mock (src/test/setup.ts) has no default
  // implementation and the hook chains .catch on raw invoke returns
  // (probe_audio_bitrate / reveal_in_folder), so an unmocked call throws;
  // clearAllMocks() drops calls, not a prior test's implementation.
  mockInvoke.mockImplementation(() => Promise.resolve(undefined))
  // Why reset audioFormat: format local-state initializes from settings, and
  // the singleton store persists across tests in this file.
  store.dispatch(
    setSettings({ dlOutputPath: '/tmp', language: 'en', audioFormat: 'mp3' }),
  )
})

async function setup(inputBitrateKbps: number | null = 320) {
  vi.mocked(open).mockResolvedValue('/in/movie.mp4')
  vi.mocked(save).mockResolvedValue('/out/song.mp3')
  mockInvoke.mockImplementation((cmd: string) =>
    cmd === 'probe_audio_bitrate'
      ? Promise.resolve(inputBitrateKbps)
      : Promise.resolve(undefined),
  )
  const { result } = renderHookWithStore(() => useAudio())
  await act(async () => {
    await result.current.handleBrowse()
  })
  await act(async () => {
    await result.current.handleChooseOutput()
  })
  return result
}

describe('useAudio', () => {
  it('browse probes the source bitrate and auto-selects best-effort', async () => {
    const result = await setup(128)
    // 128kbps source → presets above it are disabled, best-effort = 128
    expect(mockInvoke).toHaveBeenCalledWith('probe_audio_bitrate', {
      inputPath: '/in/movie.mp4',
    })
    expect(result.current.bitrateKbps).toBe(128)
    expect(result.current.status).toBe('idle')
  })

  it('probe failure falls back to null bitrate and default presets', async () => {
    // Rejection (not null resolve) exercises the .catch branch
    vi.mocked(open).mockResolvedValue('/in/movie.mp4')
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'probe_audio_bitrate'
        ? Promise.reject(new Error('ffprobe missing'))
        : Promise.resolve(undefined),
    )
    const { result } = renderHookWithStore(() => useAudio())
    await act(async () => {
      await result.current.handleBrowse()
    })
    expect(result.current.bitrateKbps).toBe(192)
    expect(result.current.status).toBe('idle')
  })

  it('setFormat persists to settings and clears the output path', async () => {
    const result = await setup()
    await act(async () => {
      result.current.setFormat('m4a')
    })
    expect(store.getState().settings.audioFormat).toBe('m4a')
    expect(result.current.outputPath).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith(
      'set_settings',
      expect.objectContaining({
        settings: expect.objectContaining({ audioFormat: 'm4a' }),
      }),
    )
  })

  it('extract invokes extract_audio with the form values and succeeds', async () => {
    const result = await setup(320)
    await act(async () => {
      await result.current.handleExtract()
    })
    expect(result.current.status).toBe('success')
    const calls = mockInvoke.mock.calls
    expect(calls[calls.length - 1]).toEqual([
      'extract_audio',
      {
        options: {
          inputPath: '/in/movie.mp4',
          outputPath: '/out/song.mp3',
          format: 'mp3',
          bitrateKbps: 320,
        },
      },
    ])
  })

  it('extract failure sets error and toasts', async () => {
    const result = await setup(320)
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'probe_audio_bitrate'
        ? Promise.resolve(320)
        : Promise.reject(new Error('boom')),
    )
    await act(async () => {
      await result.current.handleExtract()
    })
    await waitFor(() => expect(result.current.status).toBe('error'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })

  it('audio://progress events update progress while mounted', async () => {
    const result = await setup(320)
    act(() => {
      emitTauriEvent('audio://progress', {
        progress: 42,
        currentTimeSec: 10,
        totalDurationSec: 24,
      })
    })
    await waitFor(() => expect(result.current.progress?.progress).toBe(42))
  })

  it('handleReveal invokes reveal_in_folder', async () => {
    const result = await setup()
    await act(async () => {
      await result.current.handleReveal()
    })
    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/out/song.mp3',
    })
  })

  it('reset returns to pristine state', async () => {
    const result = await setup()
    act(() => {
      result.current.reset()
    })
    expect(result.current.inputPath).toBeNull()
    expect(result.current.status).toBe('idle')
  })
})
