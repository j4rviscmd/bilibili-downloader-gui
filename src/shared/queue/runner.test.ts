import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import settingsReducer, { setSettings } from '@/features/settings/settingsSlice'
import downloadStatusReducer from '@/shared/downloadStatus/downloadStatusSlice'
import progressReducer from '@/shared/progress/progressSlice'
import { mockInvoke } from '@/test/test-utils'
import queueReducer, {
  cancelDownload,
  cancelParentDownloads,
  enqueueSession,
  updateQueueItem,
} from './queueSlice'
import {
  clampConcurrency,
  createQueueRunner,
  type QueueRunnerStore,
} from './runner'
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
      settings: settingsReducer,
    },
  })
}

/** Sets the runner cap (clamped to 1..4 by the runner). */
function setCap(n: number) {
  store.dispatch(setSettings({ maxConcurrentDownloads: n }))
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
  // Cast: the thunk is typed against the app RootState; the minimal test
  // store accepts the same action shape.
  store.dispatch(
    enqueueSession({
      videoId,
      videoTitle: `title-${videoId}`,
      parts: [spec(1, baseCid), spec(2, baseCid + 1)],
    }) as never,
  )
}

const asRunnerStore = () => store as unknown as QueueRunnerStore

/** One macrotask per drain-tick interleaving. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

async function settle(times = 6) {
  for (let i = 0; i < times; i++) await tick()
}

/** Deferred executor control: release or reject one claimed part. */
type Gate = { resolve: () => void; reject: (reason?: unknown) => void }

/** Executor that records starts and parks each part until its gate fires. */
function gatedExecutor(started: number[], gates: Map<number, Gate>) {
  return (p: DownloadPartPayload) =>
    new Promise<string>((resolve, reject) => {
      started.push(p.cid)
      gates.set(p.cid, {
        resolve: () => resolve(`/out/${p.cid}.mp4`),
        reject,
      })
    })
}

/** Enqueues one session with the given part count (cids 1..n). */
function enqueueParts(count: number) {
  store.dispatch(
    enqueueSession({
      videoId: 'BVa',
      videoTitle: 't',
      parts: Array.from({ length: count }, (_, i) => spec(i + 1, i + 1)),
    }) as never,
  )
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
    // Serial slot: the sibling must still be PENDING when the cancel
    // lands, so its skip/finalize path is exercised (under the default
    // cap of 2 both parts claim together and the sibling runs).
    setCap(1)
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
    // Serial slot: keeps the sibling PENDING at cancel time — the exact
    // regression shape (a concurrently-running sibling trivially survives).
    setCap(1)
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
    // Serial slot: under the default cap of 2 both parts claim in the
    // same kick, so part 2 would already be in flight.
    setCap(1)
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

  // --- Parallel slots (maxConcurrentDownloads) --------------------------

  it('runs up to the cap parts concurrently and drains the rest', async () => {
    setCap(2)
    enqueueParts(3)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()

    // Two slots claim in FIFO partIndex order; the third stays pending.
    expect(started).toEqual([1, 2])
    expect(items().find((i) => i.kind === 'part' && i.cid === 3)?.status).toBe(
      'pending',
    )

    gates.get(1)!.resolve()
    await settle()
    expect(started).toEqual([1, 2, 3]) // freed slot claims the next part

    gates.get(2)!.resolve()
    gates.get(3)!.resolve()
    await settle()
    expect(
      items().filter((i) => i.kind === 'part' && i.status === 'done').length,
    ).toBe(3)
  })

  it('starts each part exactly once (no double claim)', async () => {
    setCap(4)
    enqueueParts(3)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()

    // All three claim in one kick — none may repeat.
    expect(started).toEqual([1, 2, 3])
    expect(new Set(started).size).toBe(started.length)

    for (const gate of gates.values()) gate.resolve()
    await settle()
    expect(
      items().filter((i) => i.kind === 'part' && i.status === 'done').length,
    ).toBe(3)
  })

  it('growing the cap launches more parts immediately', async () => {
    setCap(1)
    enqueueParts(2)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()
    expect(started).toEqual([1])

    // The settings patch notifies the store → kick re-reads the cap.
    setCap(2)
    await settle()
    expect(started).toEqual([1, 2])

    for (const gate of gates.values()) gate.resolve()
    await settle()
  })

  it('shrinking waits for running parts (non-preemptive)', async () => {
    setCap(2)
    enqueueParts(3)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()

    setCap(1)
    await settle()
    expect(started).toEqual([1, 2]) // running parts are never preempted

    gates.get(1)!.resolve()
    await settle()
    // One slot freed but cap is 1 and part 2 still runs → no new claim.
    expect(started).toEqual([1, 2])

    gates.get(2)!.resolve()
    await settle()
    expect(started).toEqual([1, 2, 3]) // below cap again → part 3 starts

    gates.get(3)!.resolve()
    await settle()
    expect(
      items().filter((i) => i.kind === 'part' && i.status === 'done').length,
    ).toBe(3)
  })

  it('clamps out-of-range caps from hand-edited settings', async () => {
    setCap(7)
    enqueueParts(5)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()

    expect(started).toEqual([1, 2, 3, 4]) // clamped to 4, not 7

    for (const gate of gates.values()) gate.resolve()
    await settle()
  })

  it('cap changes while idle do not wedge the runner', async () => {
    setCap(1)
    setCap(4)
    setCap(1) // idle churn — the runner must stay responsive
    enqueueParts(2)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()
    expect(started).toEqual([1])

    gates.get(1)!.resolve()
    await settle()
    expect(started).toEqual([1, 2])

    gates.get(2)!.resolve()
    await settle()
  })

  it('parallel parent cancel does not error running siblings', async () => {
    setCap(2)
    enqueueParts(3)
    const started: number[] = []
    const gates = new Map<number, Gate>()
    createQueueRunner(gatedExecutor(started, gates), asRunnerStore).start()
    await settle()
    expect(started).toEqual([1, 2])

    // Cancel the parent mid-flight: the pending part finalizes to
    // cancelled, and the running rejects must NOT become errors.
    store.dispatch(cancelParentDownloads(parentOf('BVa').downloadId))
    gates.get(1)!.reject(new Error('ERR::CANCELLED'))
    gates.get(2)!.reject(new Error('ERR::CANCELLED'))
    await settle()

    const parts = items().filter((i) => i.kind === 'part')
    expect(parts.every((i) => i.status !== 'error')).toBe(true)
    expect(parts.filter((i) => i.status === 'cancelled').length).toBe(3)
  })
})

describe('clampConcurrency', () => {
  // Direct export test: the runner suite reaches the clamp only through
  // numeric setSettings values — the absent/wrong-type fallbacks (a
  // hand-edited or pre-feature settings.json) and the floor are only
  // observable here. The badge in ConcurrencyLink shares this function,
  // so display and slot count stay in lockstep.
  it.each([
    [2, 2],
    [1, 1],
    [4, 4],
    [7, 4], // upper clamp
    [0, 1], // lower clamp
    [-5, 1],
    [3.7, 3], // fractional values floor, then clamp
    [1.9, 1],
    [undefined, 2], // absent (pre-feature settings.json)
    [null, 2],
    ['3', 2], // wrong type (hand-edited garbage)
    [NaN, 2],
    [Infinity, 2],
  ])('clampConcurrency(%p) -> %i', (raw, expected) => {
    expect(clampConcurrency(raw)).toBe(expected)
  })
})
