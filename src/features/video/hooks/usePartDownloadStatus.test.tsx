/**
 * usePartDownloadStatus suite.
 *
 * Seeds the real store (queue + progress slices) and asserts the derived
 * per-part status flags, including the "most recently enqueued part wins"
 * downloadId resolution.
 */

import { store } from '@/app/store'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import {
  clearQueue,
  enqueue,
  updateQueueStatus,
} from '@/shared/queue/queueSlice'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it } from 'vitest'

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

const progressBase = {
  downloadId: 'dl-p1',
  filesize: 10,
  downloaded: 1,
  transferRate: 1024,
  percentage: 10,
  deltaTime: 0.5,
  elapsedTime: 1,
  isComplete: false,
}

describe('usePartDownloadStatus', () => {
  beforeEach(() => {
    store.dispatch(clearQueue())
    store.dispatch(clearProgress())
  })

  it('returns empty status when the queue has no part', () => {
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.downloadId).toBeUndefined()
    expect(result.current.status).toBeUndefined()
    expect(result.current.isDownloading).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.hasError).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.progressEntries).toEqual([])
  })

  it('resolves the downloadId for part index 0 (-p1 suffix)', () => {
    store.dispatch(enqueue({ downloadId: 'dl-p1', status: 'running' }))
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.downloadId).toBe('dl-p1')
    expect(result.current.status).toBe('running')
    expect(result.current.isDownloading).toBe(true)
    expect(result.current.isComplete).toBe(false)
  })

  it('isDownloading is false once the complete stage arrived', () => {
    store.dispatch(enqueue({ downloadId: 'dl-p1', status: 'running' }))
    store.dispatch(
      setProgress({ ...progressBase, stage: 'complete', isComplete: true }),
    )
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.isComplete).toBe(true)
    expect(result.current.isDownloading).toBe(false)
  })

  it('exposes error fields for an errored part', () => {
    store.dispatch(
      enqueue({
        downloadId: 'dl-p1',
        status: 'error',
        errorMessage: 'boom',
        outputPath: '/out/file.mp4',
        filename: 'file.mp4',
      }),
    )
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.hasError).toBe(true)
    expect(result.current.errorMessage).toBe('boom')
    expect(result.current.outputPath).toBe('/out/file.mp4')
    expect(result.current.filename).toBe('file.mp4')
  })

  it('flags cancelling and cancelled parts', () => {
    store.dispatch(enqueue({ downloadId: 'dl-p1', status: 'cancelling' }))
    const first = renderHook(() => usePartDownloadStatus(0), { wrapper })
    expect(first.result.current.isCancelling).toBe(true)
    first.unmount()

    store.dispatch(
      updateQueueStatus({ downloadId: 'dl-p1', status: 'cancelled' }),
    )
    const second = renderHook(() => usePartDownloadStatus(0), { wrapper })
    expect(second.result.current.isCancelled).toBe(true)
    second.unmount()
  })

  it('prefers the most recently enqueued item for the same part index', () => {
    // Simulates a re-download: a stale cancelled item from a prior session
    // coexists with the fresh running one.
    store.dispatch(enqueue({ downloadId: 'old-p1', status: 'cancelled' }))
    store.dispatch(enqueue({ downloadId: 'new-p1', status: 'running' }))
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.downloadId).toBe('new-p1')
    expect(result.current.isCancelled).toBe(false)
    expect(result.current.isDownloading).toBe(true)
  })

  it('returns only the progress entries of the resolved download', () => {
    store.dispatch(enqueue({ downloadId: 'dl-p1', status: 'running' }))
    store.dispatch(enqueue({ downloadId: 'dl-p2', status: 'running' }))
    store.dispatch(setProgress({ ...progressBase, stage: 'video' }))
    store.dispatch(
      setProgress({ ...progressBase, downloadId: 'dl-p2', stage: 'video' }),
    )
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })

    expect(result.current.progressEntries).toHaveLength(1)
    expect(result.current.progressEntries[0]!.downloadId).toBe('dl-p1')
  })

  it('re-renders when the queue status updates while mounted', () => {
    store.dispatch(enqueue({ downloadId: 'dl-p1', status: 'pending' }))
    const { result } = renderHook(() => usePartDownloadStatus(0), { wrapper })
    expect(result.current.isPending).toBe(true)

    act(() => {
      store.dispatch(updateQueueStatus({ downloadId: 'dl-p1', status: 'done' }))
    })

    expect(result.current.status).toBe('done')
  })
})
