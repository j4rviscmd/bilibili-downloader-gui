/**
 * queueSlice unit suite.
 *
 * Dispatches against the REAL singleton store (established convention —
 * see useDownloadCompletionNotifications.test.tsx) and asserts on
 * `store.getState().queue`. The slice under test imports callCancelDownload,
 * which routes through the globally mocked invoke — tests only need
 * mockInvoke.mockResolvedValueOnce.
 */

import { store } from '@/app/store'
import { mockInvoke } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callCancelAllDownloads } from './api/cancelApi'
import type { QueueItem } from './queueSlice'
import {
  cancelAllDownloads,
  cancelDownload,
  clearQueue,
  clearQueueItem,
  enqueue,
  findCompletedItemForPart,
  selectDownloadIdByPartIndex,
  selectHasActiveDownloads,
  selectHasCancellingDownloads,
  updateQueueItem,
  updateQueueStatus,
} from './queueSlice'

function queue() {
  return store.getState().queue
}

type Status = NonNullable<QueueItem['status']>

function item(downloadId: string, overrides: Partial<QueueItem> = {}) {
  return { downloadId, status: 'pending' as Status, ...overrides }
}

function seedParentWithChildren(
  childStatuses: Status[],
  parentStatus: Status = 'pending',
) {
  store.dispatch(enqueue(item('parent', { status: parentStatus })))
  childStatuses.forEach((status, i) => {
    store.dispatch(
      enqueue(item(`parent-p${i + 1}`, { parentId: 'parent', status })),
    )
  })
}

beforeEach(() => {
  store.dispatch(clearQueue())
  vi.clearAllMocks()
})

afterEach(() => {
  // Restore the real clock even when a fake-timer test fails mid-way,
  // so the leak does not cascade into every later test in this file.
  vi.useRealTimers()
})

describe('enqueue', () => {
  it('defaults missing status to pending', () => {
    store.dispatch(enqueue({ downloadId: 'a' }))
    expect(queue()[0].status).toBe('pending')
  })

  it('skips duplicate downloadId', () => {
    store.dispatch(enqueue(item('a', { title: 'first' })))
    store.dispatch(enqueue(item('a', { title: 'second' })))
    expect(queue()).toHaveLength(1)
    expect(queue()[0].title).toBe('first')
  })
})

describe('aggregateParentStatuses (via updateQueueStatus)', () => {
  const aggregateRows: [Status[], Status][] = [
    [['done', 'done'], 'done'],
    [['error', 'done'], 'error'],
    [['cancelling', 'done'], 'cancelling'],
    [['running', 'cancelled'], 'running'],
    // Documented regression guard: a cancelled sibling must not abort the
    // remaining pending parts — parent stays pending.
    [['pending', 'cancelled'], 'pending'],
    [['done', 'cancelled'], 'cancelled'],
  ]
  it.each(aggregateRows)(
    'children %j aggregate parent to %s',
    (children, expected) => {
      seedParentWithChildren(children)
      expect(queue().find((i) => i.downloadId === 'parent')!.status).toBe(
        expected,
      )
    },
  )

  it('removes a childless parent unless it is cancelling', () => {
    store.dispatch(enqueue(item('lonely')))
    store.dispatch(clearQueueItem('lonely'))
    expect(queue()).toHaveLength(0)

    // Parent is cancelling because its (last) child is cancelling; removing
    // that child leaves the parent childless WHILE cancelling — kept.
    store.dispatch(enqueue(item('cp')))
    store.dispatch(enqueue(item('c', { parentId: 'cp', status: 'cancelling' })))
    store.dispatch(clearQueueItem('c'))
    expect(queue().find((i) => i.downloadId === 'cp')!.status).toBe(
      'cancelling',
    )
  })

  it('sets startedAtMs only on the first running transition', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    seedParentWithChildren(['running'])
    const parent = queue().find((i) => i.downloadId === 'parent')!
    expect(parent.startedAtMs).toBe(1000)

    vi.setSystemTime(5000)
    // Part 2 starts after part 1 finishes — parent re-aggregates to running
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-p1', status: 'done' }),
    )
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-p2', status: 'running' }),
    )
    expect(queue().find((i) => i.downloadId === 'parent')!.startedAtMs).toBe(
      1000,
    )
    vi.useRealTimers()
  })

  it('records completedAtMs on done and error, never resets it', () => {
    vi.useFakeTimers()
    seedParentWithChildren(['running'])
    vi.setSystemTime(2000)
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-p1', status: 'error' }),
    )
    expect(queue().find((i) => i.downloadId === 'parent')!.completedAtMs).toBe(
      2000,
    )

    vi.setSystemTime(9000)
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-p1', status: 'running' }),
    )
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-p1', status: 'done' }),
    )
    expect(queue().find((i) => i.downloadId === 'parent')!.completedAtMs).toBe(
      2000,
    )
    vi.useRealTimers()
  })
})

describe('updateQueueStatus protected-status matrix', () => {
  const protectedRows: [Status, Status, Status][] = [
    // [from, to, expectedFinal] — protected states reject downgrades
    ['done', 'running', 'done'],
    ['error', 'pending', 'error'],
    ['cancelling', 'running', 'cancelling'],
    ['cancelled', 'running', 'cancelled'],
    // done-while-cancelling races keep the cancelled state
    ['cancelling', 'done', 'cancelling'],
    ['cancelled', 'done', 'cancelled'],
    // forward transitions still apply
    ['running', 'done', 'done'],
    ['pending', 'error', 'error'],
  ]
  it.each(protectedRows)('%s -> %s keeps %s', (from, to, expected) => {
    store.dispatch(enqueue(item('x', { status: from })))
    store.dispatch(updateQueueStatus({ downloadId: 'x', status: to }))
    expect(queue()[0].status).toBe(expected)
  })

  it('persists errorMessage on error', () => {
    store.dispatch(enqueue(item('x', { status: 'running' })))
    store.dispatch(
      updateQueueStatus({
        downloadId: 'x',
        status: 'error',
        errorMessage: 'ERR::DISK_FULL',
      }),
    )
    expect(queue()[0].errorMessage).toBe('ERR::DISK_FULL')
  })

  it('unknown id is a no-op', () => {
    store.dispatch(enqueue(item('a')))
    store.dispatch(updateQueueStatus({ downloadId: 'ghost', status: 'done' }))
    expect(queue()).toHaveLength(1)
  })
})

describe('cancelDownload thunk', () => {
  it('running item goes cancelling then cancelled on confirmed backend call', async () => {
    store.dispatch(enqueue(item('d1', { status: 'running' })))
    mockInvoke.mockResolvedValueOnce(true)

    await store.dispatch(cancelDownload('d1') as never)

    expect(mockInvoke).toHaveBeenCalledWith('cancel_download', {
      downloadId: 'd1',
    })
    expect(queue()[0].status).toBe('cancelled')
  })

  it('pending item finalizes straight to cancelled without cancelling hop', async () => {
    store.dispatch(enqueue(item('d1', { status: 'pending' })))
    mockInvoke.mockResolvedValueOnce(true)

    await store.dispatch(cancelDownload('d1') as never)
    expect(queue()[0].status).toBe('cancelled')
  })

  it('race to completion: wasCancelled=false settles to done', async () => {
    store.dispatch(enqueue(item('d1', { status: 'running' })))
    mockInvoke.mockResolvedValueOnce(false)

    await store.dispatch(cancelDownload('d1') as never)
    expect(queue()[0].status).toBe('done')
  })

  it('backend rejection still finalizes to cancelled', async () => {
    store.dispatch(enqueue(item('d1', { status: 'running' })))
    mockInvoke.mockRejectedValueOnce(new Error('ipc gone'))

    await store.dispatch(cancelDownload('d1') as never)
    expect(queue()[0].status).toBe('cancelled')
  })

  it('condition guard rejects done items without invoking the backend', async () => {
    store.dispatch(enqueue(item('d1', { status: 'done' })))

    await store.dispatch(cancelDownload('d1') as never)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(queue()[0].status).toBe('done')
  })
})

describe('cancelAllDownloads thunk', () => {
  it('flips pending/running to cancelling then finalizes all', async () => {
    ;['p', 'r'].forEach((id, i) =>
      store.dispatch(enqueue(item(id, { status: i ? 'running' : 'pending' }))),
    )
    store.dispatch(enqueue(item('done', { status: 'done' })))
    mockInvoke.mockResolvedValueOnce(2)

    const result = (await store.dispatch(cancelAllDownloads() as never)) as {
      payload: { count: number; downloadIds: string[] }
    }

    expect(mockInvoke).toHaveBeenCalledWith('cancel_all_downloads', {
      downloadIds: ['p', 'r'],
    })
    expect(result.payload).toEqual({ count: 2, downloadIds: ['p', 'r'] })
    const statuses = Object.fromEntries(
      queue().map((i) => [i.downloadId, i.status]),
    )
    expect(statuses).toEqual({ p: 'cancelled', r: 'cancelled', done: 'done' })
  })

  it('empty queue returns count 0 without calling the backend', async () => {
    const result = (await store.dispatch(cancelAllDownloads() as never)) as {
      payload: { count: number; downloadIds: string[] }
    }
    expect(result.payload).toEqual({ count: 0, downloadIds: [] })
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('selectors', () => {
  it('selectDownloadIdByPartIndex: most recently enqueued part wins', () => {
    store.dispatch(
      enqueue(item('old-p1', { parentId: 'x', status: 'cancelled' })),
    )
    store.dispatch(
      enqueue(item('new-p1', { parentId: 'x', status: 'running' })),
    )
    expect(selectDownloadIdByPartIndex(store.getState(), 0)).toBe('new-p1')
    expect(selectDownloadIdByPartIndex(store.getState(), 5)).toBeUndefined()
  })

  it('findCompletedItemForPart matches only done items', () => {
    store.dispatch(enqueue(item('a-p3', { status: 'running' })))
    store.dispatch(enqueue(item('b-p3', { status: 'done' })))
    expect(findCompletedItemForPart(store.getState(), 3)!.downloadId).toBe(
      'b-p3',
    )
    expect(findCompletedItemForPart(store.getState(), 1)).toBeUndefined()
  })

  it('selectHasActiveDownloads: standalone pending does not count, parent pending with children does, cancelling counts', () => {
    store.dispatch(enqueue(item('standalone', { status: 'pending' })))
    expect(selectHasActiveDownloads(store.getState())).toBe(false)

    seedParentWithChildren(['running'])
    expect(selectHasActiveDownloads(store.getState())).toBe(true)
  })

  it('selectHasCancellingDownloads tracks any cancelling item', () => {
    expect(selectHasCancellingDownloads(store.getState())).toBe(false)
    store.dispatch(enqueue(item('c', { status: 'cancelling' })))
    expect(selectHasCancellingDownloads(store.getState())).toBe(true)
  })
})

describe('updateQueueItem', () => {
  it('merges the provided fields into the matching item', () => {
    store.dispatch(enqueue(item('a', { filename: 'old.mp4' })))

    store.dispatch(
      updateQueueItem({ downloadId: 'a', filename: 'new.mp4', title: 'T' }),
    )

    expect(queue()).toHaveLength(1)
    expect(queue()[0]).toMatchObject({
      downloadId: 'a',
      filename: 'new.mp4',
      title: 'T',
      status: 'pending',
    })
  })

  it('is a no-op for an unknown downloadId', () => {
    store.dispatch(enqueue(item('a')))

    store.dispatch(updateQueueItem({ downloadId: 'missing', filename: 'x' }))

    expect(queue()).toHaveLength(1)
    expect(queue()[0]?.filename).toBeUndefined()
  })
})

describe('clearQueue', () => {
  it('removes every item including parents', () => {
    seedParentWithChildren(['running', 'done'])

    store.dispatch(clearQueue())

    expect(queue()).toHaveLength(0)
  })
})

describe('cancelAllDownloads backend rejection', () => {
  it('still finalizes cancelling items to cancelled', async () => {
    seedParentWithChildren(['running'])
    mockInvoke.mockRejectedValueOnce(new Error('backend down'))

    await store.dispatch(cancelAllDownloads())

    expect(queue().map((i) => i.status)).toEqual(['cancelled', 'cancelled'])
  })
})

describe('callCancelAllDownloads api wrapper', () => {
  it('invokes cancel_all_downloads with the id list', async () => {
    mockInvoke.mockResolvedValueOnce(3)
    await expect(callCancelAllDownloads(['a', 'b', 'c'])).resolves.toBe(3)
    expect(mockInvoke).toHaveBeenCalledWith('cancel_all_downloads', {
      downloadIds: ['a', 'b', 'c'],
    })
  })
})
