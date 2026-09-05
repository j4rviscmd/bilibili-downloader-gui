/**
 * downloadProgress selectors unit suite.
 *
 * Dispatches against the real singleton store (queue + progress + input
 * slices) and asserts selector output. The sibling
 * src/__tests__/unit/downloadStatusSelectors.test.ts covers
 * selectOverallSummary.elapsedSeconds only — this file covers parent
 * resolution, per-part rows, summary counts/ratios, and the active-part
 * derivation for the compact cards.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { initPartInputs, resetInput } from '@/features/video/model/inputSlice'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import type { QueueItem } from '@/shared/queue/queueSlice'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import type { Progress } from '@/shared/ui/Progress'
import {
  selectActivePartIndex,
  selectOverallSummary,
  selectPartStatusRows,
  selectResolvedParentId,
} from './downloadProgress'

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

  it('returns null with an empty queue', () => {
    expect(selectResolvedParentId(store.getState())).toBeNull()
  })
})

describe('selectPartStatusRows', () => {
  it('returns an empty array when no parent can be resolved', () => {
    expect(selectPartStatusRows(store.getState())).toEqual([])
  })

  it('sorts rows by partIndex and skips downloadIds without a -pN suffix', () => {
    store.dispatch(enqueue(queueItem('parent-1')))
    store.dispatch(enqueue(queueItem('parent-1-p2', { parentId: 'parent-1' })))
    store.dispatch(enqueue(queueItem('parent-1-p1', { parentId: 'parent-1' })))
    // Malformed sibling id (no -pN suffix) is excluded
    store.dispatch(enqueue(queueItem('parent-1-px', { parentId: 'parent-1' })))

    const rows = selectPartStatusRows(store.getState())

    expect(rows.map((r) => r.downloadId)).toEqual([
      'parent-1-p1',
      'parent-1-p2',
    ])
    expect(rows.map((r) => r.partIndex)).toEqual([1, 2])
  })

  it('only resolves rows for the most recently enqueued parent', () => {
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'done' },
    ])
    seedFamily('parent-2', [{ id: 'parent-2-p1', status: 'running' }])

    const rows = selectPartStatusRows(store.getState())

    // parent-2 was enqueued last, so parent-1's children are not shown
    expect(rows.map((r) => r.downloadId)).toEqual(['parent-2-p1'])
  })

  it('takes titles from partInputs (0-based) with Part N fallback', () => {
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

describe('selectActivePartIndex (compact card auto-follow)', () => {
  it('returns the running part', () => {
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'running' },
      { id: 'parent-1-p3', status: 'pending' },
    ])

    expect(selectActivePartIndex(store.getState())).toBe(2)
  })

  it('falls back to the first pending part when nothing is running', () => {
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'done' },
      { id: 'parent-1-p3', status: 'pending' },
      { id: 'parent-1-p4', status: 'pending' },
    ])

    expect(selectActivePartIndex(store.getState())).toBe(3)
  })

  it('returns null when the session has no running or pending parts', () => {
    seedFamily('parent-1', [
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'cancelled' },
      { id: 'parent-1-p3', status: 'error' },
    ])

    expect(selectActivePartIndex(store.getState())).toBeNull()
  })

  it('returns null with an empty queue', () => {
    expect(selectActivePartIndex(store.getState())).toBeNull()
  })
})
