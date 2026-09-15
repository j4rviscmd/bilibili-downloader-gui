import { describe, expect, it } from 'vitest'

import type { RootState } from '@/app/store'
import { default as queueReducer, sessionEnqueued } from './queueSlice'
import {
  selectHasActiveDownloads,
  selectPartItemForVideo,
  selectQueuePartRows,
  selectQueueSummary,
} from './selectors'
import type { DownloadPartPayload, ExpectedStages, QueueItem } from './types'

type TestState = Pick<RootState, 'queue' | 'progress'>

function payload(cid: number, videoId = 'BV1'): DownloadPartPayload {
  return {
    videoId,
    cid,
    filename: `p-${cid}`,
    quality: null,
    audioQuality: null,
    durationSeconds: 60,
    thumbnailUrl: null,
    page: 1,
    epId: null,
    subtitle: null,
  }
}

const STAGES: ExpectedStages = { audioStage: true, mergeStage: true }

/** Builds a parent + parts pair directly (bypasses the slice for fixture
 * control over enqueuedAtMs ordering). */
function session(
  videoId: string,
  seq: number,
  parts: { cid: number; partIndex: number; status?: QueueItem['status'] }[],
): QueueItem[] {
  const parentId = `${videoId}-s${seq}`
  const at = seq * 1000
  const out: QueueItem[] = [
    {
      downloadId: parentId,
      kind: 'parent',
      videoId,
      title: `video-${seq}`,
      thumbnailUrl: `https://img/${seq}`,
      status: 'pending',
      enqueuedAtMs: at,
    },
  ]
  parts.forEach((p) => {
    out.push({
      downloadId: `${parentId}-p${p.partIndex}`,
      kind: 'part',
      parentId,
      videoId,
      cid: p.cid,
      partIndex: p.partIndex,
      title: `part-${p.partIndex}`,
      status: p.status ?? 'pending',
      enqueuedAtMs: at,
      expectedStages: STAGES,
      payload: payload(p.cid, videoId),
    })
  })
  return out
}

function stateOf(
  queue: QueueItem[],
  progress: RootState['progress'] = [],
): TestState {
  return { queue, progress } as TestState
}

describe('selectPartItemForVideo', () => {
  it('resolves the latest matching part by videoId+cid', () => {
    const queue = [
      ...session('BV1', 1, [{ cid: 7, partIndex: 1, status: 'done' }]),
      ...session('BV1', 2, [{ cid: 7, partIndex: 1, status: 'pending' }]),
    ]
    const state = stateOf(queue)
    expect(selectPartItemForVideo('BV1', 7)(state as RootState)?.status).toBe(
      'pending',
    )
    // Different video never matches.
    expect(selectPartItemForVideo('BV2', 7)(state as RootState)).toBeUndefined()
  })
})

describe('selectQueuePartRows', () => {
  it('lists parts flat in drain order (session FIFO, then partIndex)', () => {
    const queue = [
      ...session('BV2', 2, [
        { cid: 21, partIndex: 2 },
        { cid: 20, partIndex: 1 },
      ]),
      ...session('BV1', 1, [{ cid: 10, partIndex: 1 }]),
    ]
    const rows = selectQueuePartRows(stateOf(queue) as unknown as RootState)
    expect(rows.map((r) => r.item.cid)).toEqual([10, 20, 21])
    expect(rows[0].item.title).toBe('part-1')
  })

  it('drops orphan part items lacking a parent from the flat list', () => {
    const queue = [
      ...session('BV1', 1, [{ cid: 10, partIndex: 1 }]),
      // Orphan (parent pruned): unreachable for the runner — must not
      // crash and must not appear in the list.
      {
        ...session('BV9', 9, [{ cid: 99, partIndex: 1 }])[1],
        parentId: 'missing-parent',
      },
    ]
    const rows = selectQueuePartRows(stateOf(queue) as unknown as RootState)
    expect(rows.map((r) => r.item.cid)).toEqual([10])
  })
})

describe('selectQueueSummary', () => {
  it('counts mp4s across sessions, excluding cancelled', () => {
    const queue = [
      ...session('BV1', 1, [
        { cid: 1, partIndex: 1, status: 'done' },
        { cid: 2, partIndex: 2, status: 'cancelled' },
        { cid: 3, partIndex: 3, status: 'running' },
      ]),
      ...session('BV2', 2, [{ cid: 9, partIndex: 1, status: 'pending' }]),
    ]
    const summary = selectQueueSummary(stateOf(queue) as unknown as RootState)
    expect(summary.completedParts).toBe(1)
    expect(summary.totalParts).toBe(3)
    expect(summary.hasActive).toBe(true)
    // done=1 contributes fully; running and pending contribute 0.
    expect(summary.overallRatio).toBeCloseTo(1 / 3)
  })

  it('overrides cancelled to done when a complete progress entry exists', () => {
    const queue = [
      ...session('BV1', 1, [{ cid: 1, partIndex: 1, status: 'cancelled' }]),
    ]
    const progress = [
      {
        downloadId: `${queue[0].downloadId}-p1`,
        stage: 'complete',
        percentage: 100,
        transferRate: 0,
        isComplete: true,
      } as RootState['progress'][number],
    ]
    const summary = selectQueueSummary(
      stateOf(queue, progress) as unknown as RootState,
    )
    expect(summary.completedParts).toBe(1)
    expect(summary.totalParts).toBe(1)
  })

  it('flags isMerging only for a running part with a merge-stage entry', () => {
    const queue = [
      ...session('BV1', 1, [{ cid: 1, partIndex: 1, status: 'running' }]),
    ]
    const id = queue[1].downloadId
    const mk = (stage: string) =>
      ({
        downloadId: id,
        stage,
        percentage: 50,
        transferRate: 100,
        isComplete: false,
      }) as RootState['progress'][number]
    expect(
      selectQueueSummary(stateOf(queue, [mk('audio')]) as unknown as RootState)
        .isMerging,
    ).toBe(false)
    expect(
      selectQueueSummary(stateOf(queue, [mk('merge')]) as unknown as RootState)
        .isMerging,
    ).toBe(true)
  })

  it('sums transfer rates of running parts only, excluding retrying entries', () => {
    const queue = [
      ...session('BV1', 1, [
        { cid: 1, partIndex: 1, status: 'running' },
        { cid: 2, partIndex: 2, status: 'pending' },
      ]),
    ]
    const p1 = queue[1].downloadId
    const p2 = queue[2].downloadId
    const progress = [
      {
        downloadId: p1,
        stage: 'audio',
        percentage: 10,
        transferRate: 300,
        isComplete: false,
      },
      {
        downloadId: p1,
        stage: 'video',
        percentage: 20,
        transferRate: 500,
        isRetrying: true,
        isComplete: false,
      },
      {
        downloadId: p2,
        stage: 'audio',
        percentage: 0,
        transferRate: 999,
        isComplete: false,
      },
    ] as RootState['progress']
    const summary = selectQueueSummary(
      stateOf(queue, progress) as unknown as RootState,
    )
    expect(summary.aggregateTransferRate).toBe(300)
  })

  it('caps active thumbnails at 5 with a remainder count', () => {
    const queue: QueueItem[] = []
    for (let i = 1; i <= 7; i++) {
      queue.push(...session(`BV${i}`, i, [{ cid: i, partIndex: 1 }]))
    }
    const summary = selectQueueSummary(stateOf(queue) as unknown as RootState)
    expect(summary.activeThumbnails).toHaveLength(5)
    expect(summary.activeThumbnails[0].url).toBe('https://img/1')
    expect(summary.activeSessionRemainder).toBe(2)
  })

  it('lists one avatar per active PART, not per session', () => {
    const queue = [
      ...session('BV1', 1, [
        { cid: 1, partIndex: 1, status: 'running' },
        { cid: 2, partIndex: 2, status: 'pending' },
        { cid: 3, partIndex: 3, status: 'done' },
      ]),
    ]
    const summary = selectQueueSummary(stateOf(queue) as unknown as RootState)
    // Settled parts are not avatars; active ones are (FIFO, partIndex asc).
    expect(summary.activeThumbnails).toHaveLength(2)
    expect(summary.activeSessionRemainder).toBe(0)
    expect(summary.activeThumbnails[0].title).toBe('part-1')
    expect(summary.activeThumbnails[1].title).toBe('part-2')
  })

  it('hasActive false once every part settles', () => {
    const queue = [
      ...session('BV1', 1, [
        { cid: 1, partIndex: 1, status: 'done' },
        { cid: 2, partIndex: 2, status: 'error' },
      ]),
    ]
    expect(
      selectHasActiveDownloads(stateOf(queue) as unknown as RootState),
    ).toBe(false)
  })
})

describe('enqueueSession → selectors integration', () => {
  it('summary reflects a freshly enqueued session without progress', () => {
    // Light integration through the real reducer to catch fixture drift
    // between hand-built items and the slice's output shape.
    const parts = [
      {
        partIndex: 1,
        cid: 11,
        title: 't1',
        thumbnailUrl: null,
        expectedStages: STAGES,
        payload: payload(11),
      },
    ]
    const reduced = queueReducer(
      undefined,
      sessionEnqueued({ videoId: 'BV1', videoTitle: 'v', parts }),
    )
    const summary = selectQueueSummary(stateOf(reduced) as unknown as RootState)
    expect(summary.totalParts).toBe(1)
    expect(summary.hasActive).toBe(true)
    expect(summary.overallRatio).toBe(0)
    expect(reduced[0].kind).toBe('parent')
    expect(reduced[1].expectedStages).toEqual(STAGES)
  })
})
