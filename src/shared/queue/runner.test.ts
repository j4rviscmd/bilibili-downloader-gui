import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import downloadStatusReducer from '@/shared/downloadStatus/downloadStatusSlice'
import progressReducer from '@/shared/progress/progressSlice'
import { mockInvoke } from '@/test/test-utils'
import queueReducer, {
  cancelDownload,
  cancelParentDownloads,
  enqueueSession,
  updateQueueItem,
} from './queueSlice'
import { createQueueRunner, type QueueRunnerStore } from './runner'
import type { DownloadPartPayload } from './types'

// Toast/i18n are presentation-only in the runner's error path — mock them
// so assertions focus on queue transitions without jsdom side effects.
vi.mock('@/shared/ui/toast', () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}))
vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) =>
      `${key}${opts ? `:${JSON.stringify(opts)}` : ''}`,
  },
}))

type TestStore = ReturnType<typeof createTestStore>

function createTestStore() {
  return configureStore({
    reducer: {
      queue: queueReducer,
      progress: progressReducer,
      downloadStatus: downloadStatusReducer,
    },
  })
}

let store: TestStore

const items = () => store.getState().queue
const parentOf = (videoId: string) =>
  items().find((i) => i.kind === 'parent' && i.videoId === videoId)!

function payload(cid: number): DownloadPartPayload {
  return {
    videoId: 'BV1test',
    cid,
    filename: `part-${cid}`,
    quality: null,
    audioQuality: null,
    durationSeconds: 60,
    thumbnailUrl: null,
    page: cid,
    epId: null,
    subtitle: null,
  }
}

function spec(partIndex: number, cid: number) {
  return {
    partIndex,
    cid,
    title: `P${partIndex}`,
    thumbnailUrl: null,
    expectedStages: { audioStage: true, mergeStage: true },
    payload: payload(cid),
  }
}

function enqueueTwoPartSession(videoId: string, baseCid: number) {
  store.dispatch(
    enqueueSession({
      videoId,
      videoTitle: `title-${videoId}`,
      parts: [spec(1, baseCid), spec(2, baseCid + 1)],
    }),
  )
}

const asRunnerStore = () => store as unknown as QueueRunnerStore

/** One macrotask per drain-tick interleaving. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

async function settle(times = 6) {
  for (let i = 0; i < times; i++) await tick()
}

describe('createQueueRunner', () => {
  beforeEach(() => {
    store = createTestStore()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('drains sessions FIFO and parts in partIndex order', async () => {
    enqueueTwoPartSession('BVa', 1)
    enqueueTwoPartSession('BVb', 10)

    const executed: number[] = []
    createQueueRunner(async (p) => {
      executed.push(p.cid)
      return `/out/${p.cid}.mp4`
    }, asRunnerStore).start()
    await settle()

    expect(executed).toEqual([1, 2, 10, 11])
    const parts = items().filter((i) => i.kind === 'part')
    expect(parts.every((p) => p.status === 'done')).toBe(true)
    expect(parts.every((p) => p.outputPath === `/out/${p.cid}.mp4`)).toBe(true)
    expect(
      items()
        .filter((i) => i.kind === 'parent')
        .every((p) => p.status === 'done'),
    ).toBe(true)
  })

  it('a per-part ERR::CANCELLED rejection skips the part and continues', async () => {
    enqueueTwoPartSession('BVa', 1)

    createQueueRunner(async (p) => {
      if (p.cid === 1) throw new Error('ERR::CANCELLED')
      return `/out/${p.cid}.mp4`
    }, asRunnerStore).start()
    await settle()

    const first = items().find((i) => i.kind === 'part' && i.cid === 1)!
    const second = items().find((i) => i.kind === 'part' && i.cid === 2)!
    expect(first.status).not.toBe('error')
    expect(second.status).toBe('done')
  })

  it('a cancelling parent skips its remaining parts and finalizes orphans', async () => {
    enqueueTwoPartSession('BVa', 1)
    enqueueTwoPartSession('BVb', 10)

    createQueueRunner(async (p) => {
      if (p.cid === 1) {
        // Simulate cancelParentDownloads landing mid-part: the subtree
        // flips to cancelling, then the executor rejects.
        await store.dispatch(cancelParentDownloads(parentOf('BVa').downloadId))
        throw new Error('ERR::CANCELLED')
      }
      return `/out/${p.cid}.mp4`
    }, asRunnerStore).start()
    await settle()

    // BVa (cids 1,2) fully cancelled; BVb (cids 10,11) unaffected.
    const bvaParts = items().filter(
      (i) => i.kind === 'part' && (i.cid ?? 0) < 10,
    )
    expect(bvaParts.map((p) => p.status).sort()).toEqual([
      'cancelled',
      'cancelled',
    ])
    const bvbParts = items().filter(
      (i) => i.kind === 'part' && (i.cid ?? 0) >= 10,
    )
    expect(bvbParts.every((p) => p.status === 'done')).toBe(true)
  })

  it('a transient error marks the part error and continues the queue', async () => {
    enqueueTwoPartSession('BVa', 1)

    createQueueRunner(async (p) => {
      if (p.cid === 1) throw new Error('ERR::NETWORK blew up')
      return `/out/${p.cid}.mp4`
    }, asRunnerStore).start()
    await settle()

    const first = items().find((i) => i.kind === 'part' && i.cid === 1)!
    const second = items().find((i) => i.kind === 'part' && i.cid === 2)!
    expect(first.status).toBe('error')
    expect(first.errorMessage).toContain('ERR::NETWORK')
    expect(second.status).toBe('done')
    expect(parentOf('BVa').status).toBe('error')
  })

  it('pickNextPart finalizes orphaned pending children of cancelled parents', async () => {
    // Defensive-finalizer path: a parent settled as cancelled while some
    // children are still pending (an inconsistent state the regular cancel
    // thunks shouldn't produce, but a defensive runner must survive).
    enqueueTwoPartSession('BVa', 1)
    const parentId = parentOf('BVa').downloadId
    store.dispatch(
      updateQueueItem({ downloadId: parentId, status: 'cancelled' }),
    )

    const executed: number[] = []
    createQueueRunner(async (p) => {
      executed.push(p.cid)
      return '/out/x.mp4'
    }, asRunnerStore).start()
    await settle()

    expect(executed).toEqual([])
    const parts = items().filter((i) => i.kind === 'part')
    expect(parts.every((p) => p.status === 'cancelled')).toBe(true)
  })

  it('an enqueue after start kicks an idle runner', async () => {
    const executed: number[] = []
    createQueueRunner(async (p) => {
      executed.push(p.cid)
      return '/out/x.mp4'
    }, asRunnerStore).start()
    await settle()
    expect(executed).toEqual([])

    enqueueTwoPartSession('BVa', 1)
    await settle()
    expect(executed).toEqual([1, 2])
  })

  it('a per-part cancel of the running part never cancels its siblings', async () => {
    // Regression (found in verification): cancelling one part used to
    // aggregate the PARENT to 'cancelling', which the runner reads as a
    // whole-session cancel — the pending sibling got finalized as
    // cancelled whenever the invoke reject raced ahead of the
    // download_cancelled event. The parent's 'cancelling' must only ever
    // come from the session-level cancel thunks.
    enqueueTwoPartSession('BVa', 1)

    const executed: number[] = []
    let rejectFirst!: (e: Error) => void
    createQueueRunner((p) => {
      if (p.cid === 1) {
        return new Promise<string>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      executed.push(p.cid)
      return Promise.resolve(`/out/${p.cid}.mp4`)
    }, asRunnerStore).start()
    await tick()
    expect(items().find((i) => i.kind === 'part' && i.cid === 1)?.status).toBe(
      'running',
    )

    const firstId = items().find(
      (i) => i.kind === 'part' && i.cid === 1,
    )!.downloadId
    // Per-part cancel lands while part 1 is in flight; no
    // download_cancelled event is simulated (worst-case ordering).
    mockInvoke.mockResolvedValueOnce(true)
    // Cast: the thunk is typed against the app RootState; the minimal test
    // store accepts the same action shape.
    void store.dispatch(cancelDownload(firstId) as never)
    await tick()

    // The invoke reject arrives with only the raw cancel error.
    rejectFirst(new Error('ERR::CANCELLED'))
    await settle()

    expect(executed).toEqual([2])
    expect(items().find((i) => i.kind === 'part' && i.cid === 2)?.status).toBe(
      'done',
    )
  })

  it('stop() prevents further parts from starting', async () => {
    enqueueTwoPartSession('BVa', 1)
    const runner = createQueueRunner(async () => '/out/x.mp4', asRunnerStore)
    runner.start()
    runner.stop()
    await settle()

    const parts = items().filter((i) => i.kind === 'part')
    // Part 1 may have completed (already in flight), but part 2 must never
    // start.
    expect(parts[1].status).toBe('pending')
    expect(parts[1].outputPath).toBeUndefined()
  })
})
