/**
 * usePartDownloadStatus suite.
 *
 * Seeds the real store's queue slice and asserts the derived per-part
 * status flags. Resolution is by `videoId`+`cid` (issue #691): another
 * video's queue item must never match, and the most recently enqueued
 * matching part wins. The hook is queue-only by design — progress detail
 * lives on /downloads (see PartDownloadProgress).
 */

import { store } from '@/app/store'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { updateQueueItem, updateQueueStatus } from '@/shared/queue'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetQueue, seedSession } from '@/test/test-utils'

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

describe('usePartDownloadStatus', () => {
  beforeEach(() => {
    resetQueue()
  })

  it('returns empty status when the queue has no matching part', () => {
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })

    expect(result.current.downloadId).toBeUndefined()
    expect(result.current.status).toBeUndefined()
    expect(result.current.isDownloading).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.hasError).toBe(false)
    expect(result.current.isDone).toBe(false)
  })

  it('resolves the running part matching videoId+cid', () => {
    const parentId = seedSession('BV1', [
      { partIndex: 1, cid: 101, status: 'running' },
    ])
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })

    expect(result.current.downloadId).toBe(`${parentId}-p1`)
    expect(result.current.status).toBe('running')
    expect(result.current.isDownloading).toBe(true)
  })

  it('another video with the same cid never matches', () => {
    seedSession('BV1', [{ partIndex: 1, cid: 101, status: 'running' }])
    const { result } = renderHook(() => usePartDownloadStatus('BV2', 101), {
      wrapper,
    })
    expect(result.current.downloadId).toBeUndefined()
  })

  it('prefers the most recently enqueued matching part (re-download)', () => {
    seedSession('BV1', [{ partIndex: 1, cid: 101, status: 'done' }])
    const second = seedSession('BV1', [
      { partIndex: 1, cid: 101, status: 'pending' },
    ])
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })
    expect(result.current.downloadId).toBe(`${second}-p1`)
    expect(result.current.status).toBe('pending')
  })

  it('flags cancelling and cancelled parts', () => {
    seedSession('BV1', [{ partIndex: 1, cid: 101, status: 'cancelling' }])
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })
    expect(result.current.isCancelling).toBe(true)
  })

  it('exposes error fields for an errored part', () => {
    const parentId = seedSession('BV1', [
      { partIndex: 1, cid: 101, status: 'error' },
    ])
    // errorMessage is set by the runner / error path; write it directly.
    store.dispatch(
      updateQueueItem({ downloadId: `${parentId}-p1`, errorMessage: 'ERR::X' }),
    )
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })
    expect(result.current.hasError).toBe(true)
    expect(result.current.errorMessage).toBe('ERR::X')
  })

  it('re-renders when the queue status updates while mounted', () => {
    const parentId = seedSession('BV1', [{ partIndex: 1, cid: 101 }])
    const { result } = renderHook(() => usePartDownloadStatus('BV1', 101), {
      wrapper,
    })
    expect(result.current.isPending).toBe(true)

    act(() => {
      store.dispatch(
        updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'running' }),
      )
    })
    expect(result.current.isDownloading).toBe(true)
  })
})
