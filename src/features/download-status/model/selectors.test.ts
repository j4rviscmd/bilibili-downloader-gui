/**
 * download-status selectors unit suite.
 *
 * Dispatches against the real singleton store (queue + progress + dialog
 * slices) and asserts selector output. The sibling
 * src/__tests__/unit/downloadStatusSelectors.test.ts covers
 * selectOverallSummary.elapsedSeconds only — this file covers parent
 * resolution, per-part rows, and the summary counts/ratios.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { initPartInputs, resetInput } from '@/features/video/model/inputSlice'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import type { QueueItem } from '@/shared/queue/queueSlice'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import type { Progress } from '@/shared/ui/Progress'
import { setActiveDownloadStatusParent } from './downloadStatusDialogSlice'
import {
  selectDownloadStatusDialogOpen,
  selectDownloadStatusDialogState,
  selectOverallSummary,
  selectPartStatusRows,
  selectResolvedParentId,
} from './selectors'

type Status = NonNullable<QueueItem['status']>

function queueItem(
  downloadId: string,
  overrides: Partial<QueueItem> = {},
): QueueItem {
  return { downloadId, status: 'pending' as Status, ...overrides }
}

/** Seeds a parent and its children; children drive parent aggregation. */
function seedFamily(
  parentId: string,
  children: Array<{ id: string; status: Status }>,
) {
  store.dispatch(enqueue(queueItem(parentId)))
  children.forEach(({ id, status }) =>
    store.dispatch(enqueue(queueItem(id, { parentId, status }))),
  )
}

const baseProgress: Progress = {
  downloadId: '',
  deltaTime: 0,
  filesize: 0,
  downloaded: 0,
  transferRate: 0,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
}

function seedProgress(overrides: Partial<Progress>) {
  store.dispatch(setProgress({ ...baseProgress, ...overrides }))
}

beforeEach(() => {
  store.dispatch(clearQueue())
  store.dispatch(clearProgress())
  store.dispatch(resetInput())
  store.dispatch(setActiveDownloadStatusParent(null))
})

describe('dialog state selectors', () => {
  it('expose the raw slice state and dialogOpen flag', () => {
    expect(selectDownloadStatusDialogState(store.getState())).toEqual({
      dialogOpen: false,
      activeParentId: null,
    })
    expect(selectDownloadStatusDialogOpen(store.getState())).toBe(false)
  })
})

describe('selectResolvedParentId', () => {
  it('falls back to the most recently enqueued parent', () => {
    seedFamily('parent-1', [{ id: 'parent-1-p1', status: 'done' }])
    seedFamily('parent-2', [{ id: 'parent-2-p1', status: 'running' }])

    expect(selectResolvedParentId(store.getState())).toBe('parent-2')
  })

  it('dedupes repeated parentIds across children', () => {
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'running' },
    ])

    expect(selectResolvedParentId(store.getState())).toBe('parent-1')
  })

  it('respects an explicit activeParentId even when absent from the queue', () => {
    seedFamily('parent-1', [{ id: 'parent-1-p1', status: 'done' }])
    store.dispatch(setActiveDownloadStatusParent('ghost-parent'))

    expect(selectResolvedParentId(store.getState())).toBe('ghost-parent')
  })

  it('returns null with an empty queue and no explicit parent', () => {
    expect(selectResolvedParentId(store.getState())).toBeNull()
  })
})

describe('selectPartStatusRows', () => {
  it('returns an empty array when no parent can be resolved', () => {
    expect(selectPartStatusRows(store.getState())).toEqual([])
  })

  it('sorts rows by partIndex and skips downloadIds without a -pN suffix', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    store.dispatch(enqueue(queueItem('parent-1')))
    store.dispatch(enqueue(queueItem('parent-1-p2', { parentId: 'parent-1' })))
    store.dispatch(enqueue(queueItem('parent-1-p1', { parentId: 'parent-1' })))
    // Stray child of another parent and a malformed sibling id are excluded
    store.dispatch(enqueue(queueItem('parent-2-p1', { parentId: 'parent-2' })))
    store.dispatch(enqueue(queueItem('parent-1-px', { parentId: 'parent-1' })))

    const rows = selectPartStatusRows(store.getState())

    expect(rows.map((r) => r.downloadId)).toEqual([
      'parent-1-p1',
      'parent-1-p2',
    ])
    expect(rows.map((r) => r.partIndex)).toEqual([1, 2])
  })

  it('takes titles from partInputs (0-based) with Part N fallback', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    store.dispatch(
      initPartInputs([
        {
          cid: 1,
          page: 1,
          title: 'Episode One',
          videoQuality: '80',
          audioQuality: '30216',
          selected: true,
          duration: 60,
        },
      ]),
    )
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'running' },
      { id: 'parent-1-p2', status: 'running' },
    ])

    const rows = selectPartStatusRows(store.getState())

    expect(rows[0].title).toBe('Episode One')
    expect(rows[1].title).toBe('Part 2')
  })

  it('renders zeroed rows for children without progress entries', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    store.dispatch(enqueue(queueItem('parent-1')))
    // Undefined status must fall back to 'pending'
    store.dispatch(enqueue({ downloadId: 'parent-1-p1', parentId: 'parent-1' }))

    const [row] = selectPartStatusRows(store.getState())

    expect(row).toMatchObject({
      status: 'pending',
      percentage: 0,
      audio: null,
      video: null,
      merge: null,
      isRetrying: false,
      // pickStageData's empty branch omits stage entirely
      stage: undefined,
      isComplete: false,
    })
  })

  it('averages audio/video/merge percentages and infers 100 for stages passed', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [{ id: 'parent-1-p1', status: 'running' }])
    // video already finished (no live entry) while merge is at 80:
    // videoPct falls back to 100 because merge exists.
    seedProgress({ downloadId: 'parent-1-p1', stage: 'audio', percentage: 50 })
    seedProgress({ downloadId: 'parent-1-p1', stage: 'merge', percentage: 80 })

    const [row] = selectPartStatusRows(store.getState())

    expect(row.percentage).toBeCloseTo((50 + 100 + 80) / 3)
    expect(row.audio).toEqual({ percentage: 50, transferRate: 0 })
    expect(row.video).toBeNull()
    expect(row.merge).toEqual({ percentage: 80, transferRate: 0 })
    expect(row.stage).toBe('merge')
    expect(row.isComplete).toBe(false)
  })

  it('ORs isRetrying across the audio/video/merge stages', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [{ id: 'parent-1-p1', status: 'running' }])
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'audio',
      percentage: 10,
      isRetrying: false,
    })
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'video',
      percentage: 20,
      isRetrying: true,
    })

    const [row] = selectPartStatusRows(store.getState())

    expect(row.isRetrying).toBe(true)
    expect(row.stage).toBe('download')
  })

  it('prefers merge over the lingering subtitle entry for the stage label', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [{ id: 'parent-1-p1', status: 'running' }])
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'subtitle',
      percentage: 100,
      isComplete: true,
    })
    seedProgress({ downloadId: 'parent-1-p1', stage: 'merge', percentage: 5 })

    const [row] = selectPartStatusRows(store.getState())

    // The complete subtitle entry must not win: it is never cleared, so
    // treating it as terminal would skip the merge stage entirely.
    expect(row.stage).toBe('merge')
    expect(row.isComplete).toBe(false)
  })

  it('forces status done for a cancelled child whose file is complete', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    store.dispatch(enqueue(queueItem('parent-1')))
    store.dispatch(
      enqueue(
        queueItem('parent-1-p1', { parentId: 'parent-1', status: 'cancelled' }),
      ),
    )
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'complete',
      percentage: 100,
      isComplete: true,
    })

    const [row] = selectPartStatusRows(store.getState())

    expect(row).toMatchObject({
      status: 'done',
      stage: 'complete',
      isComplete: true,
      percentage: 100,
    })
  })
})

describe('selectOverallSummary counts and ratio', () => {
  it('excludes cancelled parts from totals and reports them separately', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'running' },
      { id: 'parent-1-p2', status: 'pending' },
      { id: 'parent-1-p3', status: 'done' },
      { id: 'parent-1-p4', status: 'error' },
      { id: 'parent-1-p5', status: 'cancelled' },
      { id: 'parent-1-p6', status: 'cancelled' },
    ])

    const summary = selectOverallSummary(store.getState())

    expect(summary).toMatchObject({
      totalParts: 4,
      completedCount: 1,
      errorCount: 1,
      cancelledCount: 2,
      activeCount: 2,
      hasActive: true,
    })
  })

  it('averages done as 1 and running as percentage/100 over active parts', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'running' },
      { id: 'parent-1-p3', status: 'cancelled' },
    ])
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'complete',
      percentage: 100,
      isComplete: true,
    })
    // (0 + 0 + 0)/3 = 0 for the running part — audio/video/merge all at 0
    seedProgress({ downloadId: 'parent-1-p2', stage: 'audio', percentage: 0 })

    const summary = selectOverallSummary(store.getState())

    // done=1, running=(0+0+0)/3=0 → (1 + 0) / 2 non-cancelled parts
    expect(summary.overallRatio).toBe(0.5)
  })

  it('flags isMerging only for a running part in the merge stage', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'running' },
      { id: 'parent-1-p2', status: 'running' },
    ])
    seedProgress({ downloadId: 'parent-1-p1', stage: 'merge', percentage: 10 })

    expect(selectOverallSummary(store.getState()).isMerging).toBe(true)

    // A merged-but-done part no longer blocks cancel-all
    seedProgress({
      downloadId: 'parent-1-p1',
      stage: 'complete',
      percentage: 100,
      isComplete: true,
    })
    expect(selectOverallSummary(store.getState()).isMerging).toBe(false)
  })

  it('returns zeroed summary when no rows exist', () => {
    const summary = selectOverallSummary(store.getState())

    expect(summary).toMatchObject({
      totalParts: 0,
      completedCount: 0,
      errorCount: 0,
      cancelledCount: 0,
      activeCount: 0,
      hasActive: false,
      isMerging: false,
      overallRatio: 0,
      elapsedSeconds: 0,
    })
  })
})
