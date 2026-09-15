/**
 * queueSlice unit suite (issue #691 redesign).
 *
 * Dispatches against the REAL singleton store (established convention —
 * see useDownloadCompletionNotifications.test.tsx) and asserts on
 * `store.getState().queue`. The slice under test imports callCancelDownload /
 * callCancelAllDownloads, which route through the globally mocked invoke —
 * tests only need mockInvoke.mockResolvedValueOnce.
 */

import { store } from '@/app/store'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import { mockInvoke } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelAllDownloads,
  cancelDownload,
  cancelParentDownloads,
  clearFinishedQueueItems,
  enqueueSession,
  removeQueueItems,
  updateQueueItem,
  updateQueueStatus,
} from './queueSlice'
import {
  selectHasActiveDownloads,
  selectHasCancellingDownloads,
} from './selectors'
import type { EnqueuePartSpec, QueueItemStatus } from './types'

function queue() {
  return store.getState().queue
}

function spec(partIndex: number, cid: number): EnqueuePartSpec {
  return {
    partIndex,
    cid,
    title: `P${partIndex}`,
    thumbnailUrl: null,
    expectedStages: { audioStage: true, mergeStage: true },
    payload: {
      videoId: 'BV1test',
      cid,
      filename: `P${partIndex}`,
      quality: null,
      audioQuality: null,
      durationSeconds: 60,
      thumbnailUrl: null,
      page: partIndex,
      epId: null,
      subtitle: null,
    },
  }
}

/** Enqueues a session and returns its parent id. */
function seedSession(
  videoId: string,
  cids: number[],
  statuses?: QueueItemStatus[],
): string {
  store.dispatch(
    enqueueSession({
      videoId,
      videoTitle: `title-${videoId}`,
      parts: cids.map((cid, i) => spec(i + 1, cid)),
    }),
  )
  const parentId = queue().find(
    (i) => i.kind === 'parent' && i.videoId === videoId,
  )!.downloadId
  if (statuses) {
    statuses.forEach((status, i) => {
      store.dispatch(
        updateQueueItem({
          downloadId: `${parentId}-p${i + 1}`,
          status,
        }),
      )
    })
    store.dispatch(
      updateQueueItem({ downloadId: parentId, status: statuses[0] }),
    )
  }
  return parentId
}

/** Re-aggregates after raw updateQueueItem writes (no aggregate in that reducer). */
function aggregate(parentId: string) {
  const children = queue().filter((i) => i.parentId === parentId)
  const statuses = children.map((c) => c.status)
  let next: QueueItemStatus = 'pending'
  if (statuses.includes('error')) next = 'error'
  else if (statuses.includes('cancelling')) next = 'cancelling'
  else if (statuses.includes('running')) next = 'running'
  else if (statuses.includes('pending')) next = 'pending'
  else if (statuses.every((s) => s === 'done')) next = 'done'
  else if (statuses.includes('cancelled')) next = 'cancelled'
  store.dispatch(updateQueueItem({ downloadId: parentId, status: next }))
}

beforeEach(() => {
  const ids = store.getState().queue.map((i) => i.downloadId)
  if (ids.length > 0) store.dispatch(removeQueueItems(ids))
  store.dispatch(clearProgress())
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('enqueueSession', () => {
  it('creates a pending parent and one pending child per part with snapshots', () => {
    const parentId = seedSession('BV1', [101, 102])
    const parent = queue().find((i) => i.downloadId === parentId)!
    expect(parent.kind).toBe('parent')
    expect(parent.videoId).toBe('BV1')
    expect(parent.title).toBe('title-BV1')
    expect(parent.status).toBe('pending')

    const children = queue().filter((i) => i.parentId === parentId)
    expect(children).toHaveLength(2)
    expect(children[0]).toMatchObject({
      kind: 'part',
      cid: 101,
      partIndex: 1,
      status: 'pending',
    })
    // downloadId format is load-bearing (progress internalIds): `{parentId}-p{n}`.
    expect(children[1].downloadId).toBe(`${parentId}-p2`)
    // Payload/expectedStages snapshots carried on the item.
    expect(children[0].payload?.cid).toBe(101)
    expect(children[0].expectedStages).toEqual({
      audioStage: true,
      mergeStage: true,
    })
    // FIFO key shared by the whole session.
    expect(children.every((c) => c.enqueuedAtMs === parent.enqueuedAtMs)).toBe(
      true,
    )
  })

  it('no-ops on an empty part list', () => {
    const before = queue().length
    store.dispatch(
      enqueueSession({ videoId: 'BV1', videoTitle: 't', parts: [] }),
    )
    expect(queue()).toHaveLength(before)
  })
})

describe('updateQueueStatus stale-event guards', () => {
  it('rejects downgrade of protected statuses to running/pending', () => {
    const parentId = seedSession('BV1', [101])
    const childId = `${parentId}-p1`
    store.dispatch(updateQueueStatus({ downloadId: childId, status: 'done' }))
    store.dispatch(
      updateQueueStatus({ downloadId: childId, status: 'running' }),
    )
    expect(queue().find((i) => i.downloadId === childId)?.status).toBe('done')
  })

  it('keeps cancelled over a late done', () => {
    const parentId = seedSession('BV1', [101])
    const childId = `${parentId}-p1`
    store.dispatch(
      updateQueueStatus({ downloadId: childId, status: 'cancelled' }),
    )
    store.dispatch(updateQueueStatus({ downloadId: childId, status: 'done' }))
    expect(queue().find((i) => i.downloadId === childId)?.status).toBe(
      'cancelled',
    )
  })

  it('stamps startedAtMs on running transition and completedAtMs on settle', () => {
    const parentId = seedSession('BV1', [101])
    const childId = `${parentId}-p1`
    store.dispatch(
      updateQueueStatus({ downloadId: childId, status: 'running' }),
    )
    let parent = queue().find((i) => i.downloadId === parentId)!
    expect(parent.startedAtMs).toBeGreaterThan(0)
    expect(parent.completedAtMs).toBeUndefined()

    store.dispatch(updateQueueStatus({ downloadId: childId, status: 'done' }))
    parent = queue().find((i) => i.downloadId === parentId)!
    expect(parent.completedAtMs).toBeGreaterThan(0)
  })
})

describe('cancelDownload', () => {
  it('finalizes a pending child immediately (no backend token)', async () => {
    const parentId = seedSession('BV1', [101, 102])
    const childId = `${parentId}-p1`
    mockInvoke.mockResolvedValueOnce(false)
    await store.dispatch(cancelDownload(childId))
    expect(queue().find((i) => i.downloadId === childId)?.status).toBe(
      'cancelled',
    )
    // Sibling untouched.
    expect(queue().find((i) => i.downloadId === `${parentId}-p2`)?.status).toBe(
      'pending',
    )
  })

  it('treats a running download that raced to completion as done', async () => {
    const parentId = seedSession('BV1', [101])
    const childId = `${parentId}-p1`
    store.dispatch(
      updateQueueStatus({ downloadId: childId, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(false) // wasCancelled=false: raced to done
    await store.dispatch(cancelDownload(childId))
    expect(queue().find((i) => i.downloadId === childId)?.status).toBe('done')
  })
})

describe('aggregate: per-part cancel must not cascade to the session', () => {
  it('keeps the parent out of cancelling while only a child is cancelling', async () => {
    // Regression (found in verification): a cancelling child used to
    // aggregate the parent to 'cancelling', which the runner interprets as
    // a whole-session cancel and finalizes the pending siblings.
    const parentId = seedSession('BV1', [101, 102])
    const firstId = `${parentId}-p1`
    const secondId = `${parentId}-p2`
    store.dispatch(
      updateQueueStatus({ downloadId: firstId, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(true)
    void store.dispatch(cancelDownload(firstId))
    // pending reducer has run: child cancelling, parent must NOT be
    // (the session still has a pending sibling, so it aggregates pending).
    const parent = queue().find((i) => i.downloadId === parentId)!
    expect(parent.status).toBe('pending')
    expect(queue().find((i) => i.downloadId === firstId)?.status).toBe(
      'cancelling',
    )

    // Backend confirms via the event: the sibling survives untouched.
    store.dispatch(
      updateQueueStatus({ downloadId: firstId, status: 'cancelled' }),
    )
    expect(queue().find((i) => i.downloadId === secondId)?.status).toBe(
      'pending',
    )
    expect(queue().find((i) => i.downloadId === parentId)?.status).toBe(
      'pending',
    )
  })

  it('keeps a session-level cancelling parent stable until the thunk finalizes', async () => {
    const parentId = seedSession('BV1', [101, 102])
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(1)
    void store.dispatch(cancelParentDownloads(parentId))
    // Child events arriving before fulfillment must not resurrect the
    // parent as pending.
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'cancelled' }),
    )
    expect(queue().find((i) => i.downloadId === parentId)?.status).toBe(
      'cancelling',
    )
  })
})

describe('enqueueSession accumulation', () => {
  it('keeps settled same-video sessions — clearing is manual only', async () => {
    // Verification decision: /downloads' Finished section accumulates for
    // the app's lifetime; enqueue must not silently remove old runs.
    const settled = seedSession('BV1', [1], ['done'])
    await store.dispatch(
      enqueueSession({ videoId: 'BV1', videoTitle: 'v1', parts: [spec(2, 2)] }),
    )
    expect(store.getState().queue.some((i) => i.parentId === settled)).toBe(
      true,
    )
    expect(
      store.getState().queue.filter((i) => i.kind === 'parent'),
    ).toHaveLength(2)
  })
})

describe('completedAtMs stamping', () => {
  it('stamps cancelled sessions too — the elapsed timer must freeze at cancel', async () => {
    // Regression (verification): a cancelled session left completedAtMs
    // unset, so /downloads recomputed elapsed from Date.now() on every
    // unrelated re-render and the timer kept counting.
    const parentId = seedSession('BV1', [101, 102])
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(1)
    await store.dispatch(cancelParentDownloads(parentId))

    const parent = queue().find((i) => i.downloadId === parentId)!
    expect(parent.status).toBe('cancelled')
    expect(parent.completedAtMs).toBeGreaterThan(0)
    expect(parent.completedAtMs).toBeGreaterThanOrEqual(parent.startedAtMs ?? 0)
  })
})

describe('cancelParentDownloads', () => {
  it('cancels only the parent subtree, leaving other sessions intact', async () => {
    const parentIdA = seedSession('BVa', [1, 2])
    const parentIdB = seedSession('BVb', [3, 4])
    // A's first part is running when the parent cancel lands.
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentIdA}-p1`, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(1)

    await store.dispatch(cancelParentDownloads(parentIdA))

    const statusesA = queue()
      .filter((i) => i.parentId === parentIdA || i.downloadId === parentIdA)
      .map((i) => i.status)
    expect(statusesA.every((s) => s === 'cancelled')).toBe(true)

    const statusesB = queue()
      .filter((i) => i.parentId === parentIdB || i.downloadId === parentIdB)
      .map((i) => i.status)
    expect(statusesB.every((s) => s === 'pending')).toBe(true)
  })
})

describe('cancelAllDownloads', () => {
  it('finalizes every cancelling item on fulfillment', async () => {
    const parentId = seedSession('BV1', [101, 102])
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'running' }),
    )
    mockInvoke.mockResolvedValueOnce(1)
    await store.dispatch(cancelAllDownloads())
    const statuses = queue().map((i) => i.status)
    expect(statuses.every((s) => s === 'cancelled')).toBe(true)
  })
})

describe('clearFinishedQueueItems', () => {
  it('removes settled sessions with children and their progress entries', async () => {
    const parentId = seedSession('BV1', [101, 102])
    const childId1 = `${parentId}-p1`
    const childId2 = `${parentId}-p2`
    // Both parts terminal.
    store.dispatch(updateQueueStatus({ downloadId: childId1, status: 'done' }))
    store.dispatch(
      updateQueueStatus({
        downloadId: childId2,
        status: 'error',
        errorMessage: 'x',
      }),
    )
    aggregate(parentId)
    // Progress entries exist for the finished part.
    store.dispatch(
      setProgress({
        downloadId: childId1,
        stage: 'complete',
        percentage: 100,
        transferRate: 0,
        isComplete: true,
      } as never),
    )
    expect(store.getState().progress.length).toBeGreaterThan(0)

    await store.dispatch(clearFinishedQueueItems())
    expect(queue().filter((i) => i.parentId === parentId)).toHaveLength(0)
    expect(queue().find((i) => i.downloadId === parentId)).toBeUndefined()
    expect(store.getState().progress).toHaveLength(0)
  })

  it('keeps sessions with an active part', async () => {
    const parentId = seedSession('BV1', [101, 102])
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'done' }),
    )
    await store.dispatch(clearFinishedQueueItems())
    expect(queue().some((i) => i.parentId === parentId)).toBe(true)
  })
})

describe('selectors regressions', () => {
  it('selectHasActiveDownloads and selectHasCancellingDownloads', () => {
    const parentId = seedSession('BV1', [101])
    expect(selectHasActiveDownloads(store.getState())).toBe(true)
    expect(selectHasCancellingDownloads(store.getState())).toBe(false)
    store.dispatch(
      updateQueueStatus({ downloadId: `${parentId}-p1`, status: 'cancelling' }),
    )
    expect(selectHasCancellingDownloads(store.getState())).toBe(true)
  })
})
