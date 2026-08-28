/**
 * useUpdateDownload suite: the Started/Progress/Finished reducer ladder,
 * no-update and failure paths, retry, restart.
 */

import { store } from '@/app/store'
import { resetUpdater } from '@/features/updater/model/updaterSlice'
import { renderHookWithStore } from '@/test/test-utils'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateDownload } from './useUpdateDownload'

beforeEach(() => {
  vi.clearAllMocks()
  store.dispatch(resetUpdater())
})

function mockUpdate(
  events: { event: string; data: Record<string, number | null> }[],
) {
  vi.mocked(check).mockResolvedValue({
    version: '1.2.0',
    downloadAndInstall: vi.fn(async (onEvent) => {
      for (const e of events) onEvent(e)
    }),
  } as never)
}

function updater() {
  return store.getState().updater
}

describe('useUpdateDownload', () => {
  it('ladders Started → Progress → Finished into Redux', async () => {
    mockUpdate([
      { event: 'Started', data: { contentLength: 200 } },
      { event: 'Progress', data: { chunkLength: 100 } },
      { event: 'Progress', data: { chunkLength: 50 } },
      { event: 'Finished', data: {} },
    ])
    const { result } = renderHookWithStore(() => useUpdateDownload())

    await act(async () => {
      await result.current.handleUpdate()
    })

    expect(updater().downloadProgress).toBe(100)
    expect(updater().isUpdateReady).toBe(true)
    expect(updater().isDownloading).toBe(false)
    expect(updater().error).toBeNull()
  })

  it('caps progress at 100 when chunks overshoot contentLength', async () => {
    mockUpdate([
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 250 } },
      { event: 'Finished', data: {} },
    ])
    const { result } = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await result.current.handleUpdate()
    })
    expect(updater().downloadProgress).toBe(100)
  })

  it('zero contentLength keeps progress at 0 until Finished', async () => {
    // Snapshot progress after each event: the intermediate Progress step
    // must stay 0 (contentLength 0 guards the ratio), only Finished lifts
    // it to 100 — otherwise this test is indistinguishable from the
    // overshoot case above.
    const snapshots: number[] = []
    vi.mocked(check).mockResolvedValue({
      version: '1.2.0',
      downloadAndInstall: vi.fn(async (onEvent) => {
        for (const e of [
          { event: 'Started', data: { contentLength: 0 } },
          { event: 'Progress', data: { chunkLength: 10 } },
          { event: 'Finished', data: {} },
        ]) {
          onEvent(e)
          snapshots.push(updater().downloadProgress)
        }
      }),
    } as never)
    const { result } = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await result.current.handleUpdate()
    })
    expect(snapshots[0]).toBe(0) // Started
    expect(snapshots[1]).toBe(0) // Progress with contentLength 0
    expect(snapshots[2]).toBe(100) // Finished
  })

  it('no update available sets the mapped error', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await result.current.handleUpdate()
    })
    expect(updater().error).toBe('updater.error.no_update_available')
    expect(updater().isDownloading).toBe(false)
    expect(updater().downloadProgress).toBe(0)
  })

  it('download failure resets progress and sets the error', async () => {
    vi.mocked(check).mockRejectedValue(new Error('network'))
    const { result } = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await result.current.handleUpdate()
    })
    expect(updater().error).toBe('updater.error.download_failed')
    expect(updater().downloadProgress).toBe(0)
    expect(updater().isDownloading).toBe(false)
  })

  it('handleRetry clears the error and re-runs the download', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('flaky'))
    mockUpdate([{ event: 'Finished', data: {} }])
    const { result } = renderHookWithStore(() => useUpdateDownload())

    await act(async () => {
      await result.current.handleUpdate()
    })
    expect(updater().error).not.toBeNull()

    act(() => {
      result.current.handleRetry()
    })
    await waitFor(() => expect(updater().isUpdateReady).toBe(true))
    await waitFor(() => expect(updater().error).toBeNull())
    expect(updater().isUpdateReady).toBe(true)
  })

  it('handleRestart relaunches; failure sets restart_failed', async () => {
    vi.mocked(relaunch).mockResolvedValue(undefined)
    const ok = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await ok.result.current.handleRestart()
    })
    expect(relaunch).toHaveBeenCalledTimes(1)

    vi.mocked(relaunch).mockRejectedValue(new Error('nope'))
    const fail = renderHookWithStore(() => useUpdateDownload())
    await act(async () => {
      await fail.result.current.handleRestart()
    })
    expect(updater().error).toBe('updater.error.restart_failed')
  })
})
