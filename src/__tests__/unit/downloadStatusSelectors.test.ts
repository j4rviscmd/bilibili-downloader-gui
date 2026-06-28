import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RootState } from '@/app/store'
import { selectOverallSummary } from '@/features/download-status/model/selectors'
import type { QueueItem } from '@/shared/queue/queueSlice'
import type { Progress } from '@/shared/ui/Progress'

/**
 * Minimal state shape exercised by selectOverallSummary. Only the slices the
 * selector (and its input selectors) read are populated; the rest of RootState
 * is irrelevant here.
 */
type TestState = Pick<
  RootState,
  'downloadStatusDialog' | 'queue' | 'progress' | 'input'
>

function makeState(overrides: Partial<TestState> = {}): TestState {
  return {
    downloadStatusDialog: { dialogOpen: true, activeParentId: 'parent-1' },
    queue: [],
    progress: [],
    input: { partInputs: [] } as unknown as TestState['input'],
    ...overrides,
  }
}

const child = (status: QueueItem['status']): QueueItem => ({
  downloadId: 'parent-1-p1',
  parentId: 'parent-1',
  status,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectOverallSummary - elapsedSeconds (real wall-clock time)', () => {
  it('uses real elapsed time from parent.startedAtMs while running', () => {
    // 10s of real time elapsed since start. The old logic summed audio + video
    // stage elapsed times (each ~10s because they run in parallel via
    // tokio::try_join!), which would have produced ~20s. A single parent clock
    // yields the true 10s.
    vi.spyOn(Date, 'now').mockReturnValue(11_000)
    const state = makeState({
      queue: [
        { downloadId: 'parent-1', status: 'running', startedAtMs: 1_000 },
        child('running'),
      ],
    })

    expect(selectOverallSummary(state as RootState).elapsedSeconds).toBe(10)
  })

  it('freezes at completion time once parent.completedAtMs is set', () => {
    // Download finished at 5s. Even after the clock advances to 60s, the
    // displayed elapsed time stays pinned to the completion instant.
    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    const state = makeState({
      queue: [
        {
          downloadId: 'parent-1',
          status: 'done',
          startedAtMs: 1_000,
          completedAtMs: 6_000,
        },
        child('done'),
      ],
      progress: [
        {
          downloadId: 'parent-1-p1',
          stage: 'complete',
          isComplete: true,
          percentage: 100,
        } as Progress,
      ],
    })

    expect(selectOverallSummary(state as RootState).elapsedSeconds).toBe(5)
  })

  it('returns 0 when the parent has no startedAtMs yet', () => {
    const state = makeState({
      queue: [{ downloadId: 'parent-1', status: 'pending' }, child('pending')],
    })

    expect(selectOverallSummary(state as RootState).elapsedSeconds).toBe(0)
  })
})
