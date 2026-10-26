import i18n from '@/i18n'
import { setError } from '@/shared/downloadStatus/downloadStatusSlice'
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { toast } from '@/shared/ui/toast'

import type { PartExecutor } from './api/executeDownloadPart'
import { updateQueueItem, updateQueueStatus } from './queueSlice'
import type { QueueItem } from './types'

export type { PartExecutor } from './api/executeDownloadPart'

/**
 * Minimal store surface the runner needs. Decoupled from the concrete
 * Redux store type so tests can pass a plain object store (same seam idea
 * as the Rust `with_path` constructors).
 */
export type QueueRunnerStore = {
  getState: () => {
    queue: QueueItem[]
    // Structural (not imported from features/settings): the shared queue
    // domain must not depend upward on a feature layer.
    settings: { maxConcurrentDownloads?: number }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match redux dispatch looseness without importing the store type
  dispatch: (action: any) => unknown
  subscribe: (listener: () => void) => () => void
}

/**
 * Bilibili-side transient error codes: the built-in retry exhausts, but a
 * later manual retry typically succeeds (CDN instability) — the toast
 * appends a retry hint for these (inherited from VideoInfoContext).
 */
const TRANSIENT_ERROR_CODES = [
  'ERR::NETWORK',
  'ERR::INVALID_MEDIA_RESPONSE',
  'ERR::AUDIO_DOWNLOAD_FAILED',
  'ERR::RATE_LIMITED',
]

/** Hard bounds for maxConcurrentDownloads (spec: 1..4, default 2). */
const CAP_MIN = 1
const CAP_MAX = 4
const CAP_FALLBACK = 2

/**
 * Clamps a raw maxConcurrentDownloads to the hard bounds; absent or
 * hand-edited garbage falls back to 2. Shared with the bottom-bar
 * concurrency badge so display and slot count can never disagree.
 */
export function clampConcurrency(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CAP_FALLBACK
  return Math.min(CAP_MAX, Math.max(CAP_MIN, Math.floor(raw)))
}

/**
 * FIFO queue runner with N parallel part slots (maxConcurrentDownloads,
 * default 2). Lives OUTSIDE React — started once from main.tsx, claims
 * queue parts while free slots remain, and never keeps component-lifetime
 * state. `store.subscribe` kicks the runner; a re-entrancy guard inside
 * kick absorbs the subscriber notifications fired by its own dispatches.
 *
 * The executor is injected (`createQueueRunner(executor, getStore)`), so
 * runner unit tests pass a fake executor and assert ordering/cancel/error
 * flows without Tauri.
 */
export function createQueueRunner(
  executor: PartExecutor,
  getStore: () => QueueRunnerStore,
): { start: () => () => void; stop: () => void } {
  let activeCount = 0
  let stopped = false

  /**
   * Picks the next part to download: the FIFO-first parent that is neither
   * cancelling nor cancelled and still has a pending child. Children within
   * a session run in enqueue (partIndex) order.
   */
  function pickNextPart(): QueueItem | null {
    const queue = getStore().getState().queue
    const parents = queue
      .filter((i) => i.kind === 'parent')
      .sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs)

    for (const parent of parents) {
      const children = queue.filter((i) => i.parentId === parent.downloadId)

      if (parent.status === 'cancelling' || parent.status === 'cancelled') {
        // Orphaned pending children (moved from VideoInfoContext's post-loop
        // cleanup): finalize to 'cancelled' so they stop reading as queued.
        for (const child of children) {
          if (child.status === 'pending') {
            getStore().dispatch(
              updateQueueStatus({
                downloadId: child.downloadId,
                status: 'cancelled',
              }),
            )
          }
        }
        continue
      }

      const pending = children.find((c) => c.status === 'pending')
      if (pending) return pending
    }
    return null
  }

  /**
   * Claims the next part: picks AND flips it to 'running' in the same
   * synchronous tick. No await may separate the two, so two slots can
   * never claim the same part (JS runs this on a single thread). The
   * backend spends seconds fetching playurl before the first progress
   * event, so the part must read as started immediately at claim time.
   */
  function claimNextPart(): QueueItem | null {
    const next = pickNextPart()
    if (!next) return null
    getStore().dispatch(
      updateQueueStatus({ downloadId: next.downloadId, status: 'running' }),
    )
    return next
  }

  /** Runs one claimed part to completion, classifying the outcome. */
  async function runPart(item: QueueItem): Promise<void> {
    const dispatch = getStore().dispatch
    const ids = { downloadId: item.downloadId, parentId: item.parentId! }

    try {
      const outputPath = await executor(item.payload!, ids)
      dispatch(updateQueueItem({ downloadId: ids.downloadId, outputPath }))
      // Mark done on invoke resolve rather than waiting for the 'complete'
      // progress event, which can race the invoke response.
      dispatch(
        updateQueueStatus({ downloadId: ids.downloadId, status: 'done' }),
      )
    } catch (error) {
      handlePartError(item, error)
    }
  }

  /** Classifies a part rejection; cancel rejections leave the queue untouched. */
  function handlePartError(item: QueueItem, error: unknown): void {
    const raw = String(error)
    logger.error(`Queue runner: part failed id=${item.downloadId}`, raw)

    const queue = getStore().getState().queue
    const self = queue.find((q) => q.downloadId === item.downloadId)
    const parent = queue.find((q) => q.downloadId === item.parentId)
    // Cancel-induced reject: don't mark as error. Check the error string AND
    // the queue status (self/parent) so a non-ERR::CANCELLED message during
    // a cancel doesn't wrongly become an error (inherited from downloadVideo).
    const isCancel =
      raw.includes('ERR::CANCELLED') ||
      self?.status === 'cancelling' ||
      self?.status === 'cancelled' ||
      parent?.status === 'cancelling' ||
      parent?.status === 'cancelled'
    if (isCancel) return

    getStore().dispatch(
      updateQueueStatus({
        downloadId: item.downloadId,
        status: 'error',
        errorMessage: raw,
      }),
    )
    notifyPartError(item, raw)
  }

  /**
   * Per-part failure toast + global error state (moved verbatim in spirit
   * from VideoInfoContext's catch block so background downloads report the
   * same way foreground ones used to).
   */
  function notifyPartError(item: QueueItem, raw: string): void {
    const key = mapBackendError(raw)
    // Constraint: when mapBackendError has no mapping AND the raw error is
    // ERR::UNAUTHORIZED, skip — session expiry is handled centrally by
    // interceptInvokeError/handleSessionExpiry, which emits its own toast.
    // (Inlined check: importing app/lib from the shared queue domain would
    // invert the layering.)
    const description = key
      ? i18n.t(key)
      : raw.includes('ERR::UNAUTHORIZED')
        ? null
        : raw
    if (!description) return

    const isTransientError = TRANSIENT_ERROR_CODES.some((code) =>
      raw.includes(code),
    )
    const retryHint = isTransientError ? i18n.t('video.retry_hint') : undefined
    const partDescription = i18n.t('video.download_failed_part_description', {
      page: item.payload?.page ?? item.partIndex ?? 0,
      title: item.title,
      description,
    })
    // The wrapper (`@/shared/ui/toast`) injects the Copy button and disables
    // the close button app-wide, so only the localized text is passed.
    toast.error(i18n.t('video.download_failed'), {
      duration: Infinity,
      description: retryHint
        ? `${partDescription}\n${retryHint}`
        : partDescription,
    })
    getStore().dispatch(
      setError(retryHint ? `${description}\n${retryHint}` : description),
    )
  }

  /**
   * Launches parts while free slots remain. Each finished part re-kicks,
   * which also re-reads the cap — growing applies instantly, shrinking
   * only gates new launches (running parts are never preempted).
   *
   * Re-entrancy guard: the claim/status dispatches inside the loop fire
   * the store subscribers synchronously, which would call kick() again
   * mid-loop and over-claim past the cap (the serial runner's old
   * `isDraining` guard covered the same window). Re-entrant calls set a
   * flag and the outer loop re-runs once it settles, so enqueues landing
   * mid-kick are still picked up.
   */
  let inKick = false
  let kickAgain = false
  function kick(): void {
    if (inKick) {
      kickAgain = true
      return
    }
    inKick = true
    try {
      do {
        kickAgain = false
        while (
          !stopped &&
          activeCount <
            clampConcurrency(
              getStore().getState().settings.maxConcurrentDownloads,
            )
        ) {
          const next = claimNextPart()
          if (!next) break
          activeCount++
          void runPart(next).finally(() => {
            activeCount--
            kick()
          })
        }
      } while (kickAgain)
    } finally {
      inKick = false
    }
  }

  return {
    /**
     * Starts the runner: subscribes to the store (kicks whenever the
     * queue or settings change) and kicks immediately for anything
     * already enqueued. Returns the unsubscribe function.
     */
    start() {
      const unsubscribe = getStore().subscribe(() => {
        if (!stopped) kick()
      })
      kick()
      return unsubscribe
    },
    /** Stops accepting new work (tests / teardown). */
    stop() {
      stopped = true
    },
  }
}
