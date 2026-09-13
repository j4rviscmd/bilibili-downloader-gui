import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import { clearProgressByDownloadId } from '@/shared/progress/progressSlice'
import { callCancelAllDownloads, callCancelDownload } from './api/cancelApi'
import type { EnqueueSessionPayload, QueueItem, QueueItemStatus } from './types'

export type { QueueItem, QueueItemStatus } from './types'

/**
 * Aggregates parent queue item statuses based on their children.
 *
 * Updates parent status based on the statuses of all child items with
 * matching parentId. Status priority: error > running > pending > done >
 * cancelled — a parent's 'cancelling' is never derived from children (see
 * the in-loop @why: per-part cancel must not cascade to the session).
 * If no children exist and parent is not in 'cancelling' state, removes the parent from the queue.
 *
 * @param state - Current queue array to modify
 */
function aggregateParentStatuses(state: QueueItem[]): void {
  const parentIds = new Set(
    state.map((i) => i.parentId).filter((id): id is string => id != null),
  )

  const parentsToRemove: string[] = []

  parentIds.forEach((parentId) => {
    const parent = state.find((i) => i.downloadId === parentId)
    if (!parent) return

    const children = state.filter((i) => i.parentId === parentId)

    if (children.length === 0) {
      if (parent.status !== 'cancelling') {
        parentsToRemove.push(parentId)
      }
      return
    }

    const statuses = children.map((c) => c.status)

    // A parent already in 'cancelling' is a SESSION-level cancel in flight
    // (cancelAllDownloads / cancelParentDownloads set the parent item
    // itself). Keep it: the thunk's fulfilled case finalizes it to
    // 'cancelled', and re-deriving from children here would resurrect a
    // mid-cancel parent as 'pending' and strand it.
    if (parent.status === 'cancelling') return

    // Priority: error > running > pending > done > cancelled.
    // A pending child means the playlist hasn't finished yet, so a cancelled
    // sibling (from a per-part cancel) must NOT flip the parent to
    // 'cancelled' — that would abort the remaining parts in the serial
    // download loop. Only once every remaining part is done/cancelled does
    // the parent settle to 'cancelled' (or 'done' if nothing was skipped).
    //
    // @why 'cancelling' is deliberately NOT derived from children: a
    //   per-part cancel flips only that child, and the runner treats a
    //   'cancelling' PARENT as "whole session cancelled" (it finalizes the
    //   pending siblings). Deriving it here made cancelling ONE part kill
    //   its siblings whenever the invoke reject raced ahead of the
    //   download_cancelled event (IPC ordering is not guaranteed).
    //   Children in 'cancelling' are simply skipped by the runner's
    //   pending-pick and settle via the event / thunk fulfillment.
    const previousStatus = parent.status
    let nextStatus: QueueItemStatus
    if (statuses.includes('error')) {
      nextStatus = 'error'
    } else if (statuses.includes('running')) {
      nextStatus = 'running'
    } else if (statuses.includes('pending')) {
      nextStatus = 'pending'
    } else if (statuses.every((s) => s === 'done')) {
      nextStatus = 'done'
    } else if (statuses.includes('cancelled')) {
      nextStatus = 'cancelled'
    } else {
      nextStatus = 'pending'
    }
    parent.status = nextStatus

    // @why: Record wall-clock timestamps on parent lifecycle transitions so
    //   /downloads can show real elapsed time. audio and video stages run
    //   in parallel (tokio::try_join!), each emitting its own elapsed time —
    //   summing them makes the timer advance at ~2x real time. A single parent
    //   clock sidesteps that entirely. The existing-value guard keeps the
    //   original start/completion time even if the parent is re-aggregated
    //   (e.g. a later part starts after an earlier one finishes).
    if (
      nextStatus === 'running' &&
      previousStatus !== 'running' &&
      !parent.startedAtMs
    ) {
      parent.startedAtMs = Date.now()
    }
    // @why: Stamp the completion time only when the session has actually
    //   settled. 'error' outranks 'pending'/'running' in the priority above,
    //   so a mid-session part failure aggregates the parent to 'error' while
    //   its siblings are still queued — stamping there would freeze the
    //   elapsed timer at the first failure for the rest of the session
    //   (transient errors don't stop the serial loop; the remaining parts
    //   keep downloading). Only a parent whose children are all terminal
    //   (done/cancelled/error) is complete.
    const sessionSettled = statuses.every(
      (s) => s === 'done' || s === 'cancelled' || s === 'error',
    )
    if (
      (nextStatus === 'done' || nextStatus === 'error') &&
      sessionSettled &&
      !parent.completedAtMs
    ) {
      parent.completedAtMs = Date.now()
    }
  })

  parentsToRemove.forEach((parentId) => {
    const index = state.findIndex((i) => i.downloadId === parentId)
    if (index !== -1) {
      state.splice(index, 1)
    }
  })
}

/**
 * Empty initial state for the queue slice. The queue is populated at
 * runtime as downloads are enqueued. Session-scoped by design: a reload
 * drops pending items, which is the accepted MVP behavior (issue #691).
 */
const initialState: QueueItem[] = []

/**
 * Async thunk to cancel a specific download.
 *
 * Sets the download status to 'cancelling' before calling the backend,
 * then the status will be updated to 'cancelled' via the 'download_cancelled' event.
 *
 * @param downloadId - Unique identifier of the download to cancel
 */
export const cancelDownload = createAsyncThunk<
  { downloadId: string; wasCancelled: boolean },
  string,
  { state: RootState; pendingMeta: { wasPending: boolean } }
>(
  'queue/cancelDownload',
  async (downloadId) => {
    // Note: cancellability is enforced in `condition` (runs before the
    // pending reducer), not here. By the time this runs, the pending
    // reducer may have already finalized a pending child to 'cancelled', so
    // a status check here would wrongly abort the backend call that sets
    // mark_cancelled — and the part would later be re-downloaded.
    const wasCancelled = await callCancelDownload(downloadId)
    return { downloadId, wasCancelled }
  },
  {
    // Run before the pending reducer flips the status. Reject done/error
    // items here: returning false aborts before pending fires, leaving the
    // status unchanged.
    condition: (downloadId, { getState }) => {
      const item = getState().queue.find((i) => i.downloadId === downloadId)
      if (!item) return false
      return ['pending', 'running', 'cancelling'].includes(item.status || '')
    },
    // Capture the pre-cancel status BEFORE the pending reducer flips it to
    // 'cancelling'. The pending reducer uses it to finalize a pre-enqueued
    // pending child (no backend token) immediately as 'cancelled'.
    getPendingMeta: ({ arg }, { getState }) => {
      const item = getState().queue.find((i) => i.downloadId === arg)
      return { wasPending: item?.status === 'pending' }
    },
  },
)

/**
 * Async thunk to cancel all active downloads.
 *
 * Sets all pending/running downloads to 'cancelling' before calling the backend.
 */
export const cancelAllDownloads = createAsyncThunk(
  'queue/cancelAllDownloads',
  async (_, { getState }) => {
    const state = getState() as RootState
    // Include 'cancelling': this thunk's own pending action has already
    // flipped pending/running items to 'cancelling' before this body runs,
    // so filtering only pending/running would drop them and short-circuit
    // without ever calling the backend (the backend cancel never fires,
    // while the frontend still settles to 'cancelled' — the exact bug we
    // saw where P0 "cancelled" but kept downloading).
    const cancellableIds = state.queue
      .filter((i) =>
        ['pending', 'running', 'cancelling'].includes(i.status || ''),
      )
      .map((i) => i.downloadId)

    if (cancellableIds.length === 0) {
      return { count: 0, downloadIds: [] as string[] }
    }

    const count = await callCancelAllDownloads(cancellableIds)
    return { count, downloadIds: cancellableIds }
  },
)

/**
 * Async thunk to cancel one parent session and its whole subtree.
 *
 * @why Cancelling the parent downloadId alone is a trap: a pending parent
 *   holds no backend token, so `cancelDownload(parentId)` would finalize the
 *   PARENT as 'cancelled' while never touching its children — the runner
 *   would then happily download every part. Cancelling must enumerate the
 *   children and go through the backend's batch cancel (which pre-marks
 *   pending children so `download_video` rejects them on start), scoped to
 *   this parent's subtree only.
 *
 * @param parentId - downloadId of the parent session to cancel
 */
export const cancelParentDownloads = createAsyncThunk(
  'queue/cancelParentDownloads',
  async (parentId: string, { getState }) => {
    const state = getState() as RootState
    const subtreeIds = state.queue
      .filter((i) => i.downloadId === parentId || i.parentId === parentId)
      .filter((i) =>
        ['pending', 'running', 'cancelling'].includes(i.status ?? ''),
      )
      .map((i) => i.downloadId)

    if (subtreeIds.length === 0) {
      return { count: 0, downloadIds: [] as string[] }
    }

    const count = await callCancelAllDownloads(subtreeIds)
    return { count, downloadIds: subtreeIds }
  },
)

/**
 * Async thunk to clear finished (settled) sessions from the queue.
 *
 * Removes every parent whose subtree is fully terminal
 * (done/cancelled/error) together with its children, and clears the
 * matching progress entries. This replaces the queue-wiping role the old
 * `clearQueue` action played (it was dispatched on every URL navigation);
 * without a cleaner, progress entries accumulate for the whole session.
 */
export const clearFinishedQueueItems = createAsyncThunk(
  'queue/clearFinishedQueueItems',
  async (_, { getState, dispatch }) => {
    const queue = (getState() as RootState).queue
    const TERMINAL = ['done', 'cancelled', 'error']
    const ids: string[] = []

    for (const parent of queue.filter((i) => i.kind === 'parent')) {
      const children = queue.filter((i) => i.parentId === parent.downloadId)
      const settled =
        children.length > 0 &&
        children.every((c) => TERMINAL.includes(c.status ?? ''))
      if (!settled) continue
      ids.push(parent.downloadId, ...children.map((c) => c.downloadId))
    }

    if (ids.length > 0) {
      dispatch(queueSlice.actions.removeQueueItems(ids))
      ids.forEach((id) => dispatch(clearProgressByDownloadId(id)))
    }
    return { removed: ids.length, downloadIds: ids }
  },
)

/**
 * Redux slice for the download queue (issue #691).
 *
 * Manages the session-scoped serial download queue: enqueueing whole
 * sessions (`enqueueSession`), lifecycle updates driven by the runner and
 * backend events, and cancellation (single / parent subtree / all).
 * Automatically updates parent status based on children.
 */
export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    /**
     * Enqueues one download session: a parent item plus a pending child
     * for every selected part, all sharing a fresh `enqueuedAtMs`.
     *
     * Atomic by design — the caller (VideoInfoContext.download) snapshots
     * the current part inputs into the payload, so subsequent edits to
     * `state.input` (title/quality/subtitle changes, URL navigation,
     * deselection) never leak into an already-enqueued session.
     */
    enqueueSession(state, action: PayloadAction<EnqueueSessionPayload>) {
      const { videoId, videoTitle, parts } = action.payload
      if (parts.length === 0) return
      // Each session gets a unique parentId so /downloads shows a fresh
      // card every time. Child downloadIds derive from parentId
      // (`{parentId}-p{n}` — format is load-bearing, see QueueItem docs).
      const parentId = `${videoId}-${crypto.randomUUID()}`
      const now = Date.now()
      state.push({
        downloadId: parentId,
        kind: 'parent',
        videoId,
        title: videoTitle,
        thumbnailUrl: parts[0]?.thumbnailUrl ?? null,
        status: 'pending',
        enqueuedAtMs: now,
      })
      for (const part of parts) {
        state.push({
          downloadId: `${parentId}-p${part.partIndex}`,
          kind: 'part',
          parentId,
          videoId,
          cid: part.cid,
          partIndex: part.partIndex,
          title: part.title,
          thumbnailUrl: part.thumbnailUrl,
          status: 'pending',
          enqueuedAtMs: now,
          expectedStages: part.expectedStages,
          payload: part.payload,
        })
      }
      aggregateParentStatuses(state)
    },
    /** Removes the given items by downloadId (used by clearFinishedQueueItems). */
    removeQueueItems(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload)
      const filtered = state.filter((i) => !ids.has(i.downloadId))
      state.length = 0
      state.push(...filtered)
      aggregateParentStatuses(state)
    },
    /**
     * Updates the status of a queue item.
     * Automatically aggregates parent status based on children.
     *
     * Protected states (done, error, cancelled, cancelling) reject downgrade
     * to running/pending. This prevents stale progress events that arrive
     * after invoke resolve (or during cancellation) from reviving a finished
     * item and locking the UI — Tauri IPC does not guarantee event-listener
     * vs invoke-resolve ordering.
     */
    updateQueueStatus(
      state,
      action: PayloadAction<{
        downloadId: string
        status: QueueItemStatus
        errorMessage?: string
      }>,
    ) {
      const { downloadId, status, errorMessage } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (!target) {
        aggregateParentStatuses(state)
        return
      }

      const PROTECTED_STATUSES = ['done', 'error', 'cancelled', 'cancelling']
      const DOWNGRADE_STATUSES = ['running', 'pending']
      // Ignore stale progress event arriving after completion or
      // during cancellation. This prevents the UI from briefly
      // snapping back to "downloading" when the user just cancelled.
      if (
        PROTECTED_STATUSES.includes(target.status ?? '') &&
        DOWNGRADE_STATUSES.includes(status)
      ) {
        return
      }
      // Ignore complete (done) while cancelling/cancelled. Even if the backend
      // download finishes after a cancel request, keep the cancelled state.
      if (
        (target.status === 'cancelling' || target.status === 'cancelled') &&
        status === 'done'
      ) {
        return
      }

      target.status = status
      if (errorMessage) target.errorMessage = errorMessage

      aggregateParentStatuses(state)
    },
    /**
     * Updates a queue item with new data.
     * Merges provided fields with existing item data.
     */
    updateQueueItem(
      state,
      action: PayloadAction<Partial<QueueItem> & { downloadId: string }>,
    ) {
      const { downloadId, ...fields } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (target) {
        Object.assign(target, fields)
      }
    },
    /**
     * Removes a single queue item by download ID.
     * Updates parent status after removal.
     */
    clearQueueItem(state, action: PayloadAction<string>) {
      const id = action.payload
      const filtered = state.filter((i) => i.downloadId !== id)
      state.length = 0
      state.push(...filtered)
      aggregateParentStatuses(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(cancelDownload.pending, (state, action) => {
      const item = state.find((i) => i.downloadId === action.meta.arg)
      if (item) {
        // wasPending is captured pre-cancel in pendingMeta (before this
        // reducer runs). A pre-enqueued pending child has no backend token,
        // so cancel can only pre-mark it (mark_cancelled). Finalize to
        // 'cancelled' immediately instead of routing through 'cancelling',
        // which the fulfilled case relies on to detect a running→done race.
        item.status = action.meta.wasPending ? 'cancelled' : 'cancelling'
      }
      aggregateParentStatuses(state)
    })

    // Finalize the cancel status of a running download. Only running
    // downloads reach here with status 'cancelling' (pending children were
    // finalized in the pending case). wasCancelled=false means it raced to
    // completion just before the cancel signal arrived, so treat as done.
    builder.addCase(cancelDownload.fulfilled, (state, action) => {
      const { wasCancelled } = action.payload
      const item = state.find((i) => i.downloadId === action.meta.arg)
      if (item && item.status === 'cancelling') {
        item.status = wasCancelled ? 'cancelled' : 'done'
      }
      aggregateParentStatuses(state)
    })

    builder.addCase(cancelDownload.rejected, (state, action) => {
      const item = state.find((i) => i.downloadId === action.meta.arg)
      if (item && item.status === 'cancelling') {
        item.status = 'cancelled'
      }
      aggregateParentStatuses(state)
    })

    builder.addCase(cancelAllDownloads.pending, (state) => {
      state.forEach((item) => {
        if (item.status === 'pending' || item.status === 'running') {
          item.status = 'cancelling'
        }
      })
      aggregateParentStatuses(state)
    })

    // cancel_all_downloads only cancels in-flight download_video; pre-enqueued
    // (pending) children are not cancelled by the backend. Finalize
    // cancelling → cancelled on fulfillment.
    builder.addCase(cancelAllDownloads.fulfilled, (state) => {
      // Finalize every cancelling item (children and parents). Parents can
      // get stuck in cancelling when their children were removed by
      // download_cancelled events arriving before this fulfilled action.
      state.forEach((item) => {
        if (item.status === 'cancelling') {
          item.status = 'cancelled'
        }
      })
      aggregateParentStatuses(state)
    })

    // If the backend call fails, still finalize cancelling → cancelled to
    // avoid permanently locking the UI in "cancelling".
    builder.addCase(cancelAllDownloads.rejected, (state) => {
      state.forEach((item) => {
        if (item.status === 'cancelling') {
          item.status = 'cancelled'
        }
      })
      aggregateParentStatuses(state)
    })

    // Parent-subtree cancel: same protocol as cancelAllDownloads, scoped to
    // the parent's items only — other queued sessions must keep draining.
    builder.addCase(cancelParentDownloads.pending, (state, action) => {
      const parentId = action.meta.arg
      state.forEach((item) => {
        if (
          (item.downloadId === parentId || item.parentId === parentId) &&
          (item.status === 'pending' || item.status === 'running')
        ) {
          item.status = 'cancelling'
        }
      })
      aggregateParentStatuses(state)
    })

    builder.addCase(cancelParentDownloads.fulfilled, (state, action) => {
      const parentId = action.meta.arg
      state.forEach((item) => {
        if (
          (item.downloadId === parentId || item.parentId === parentId) &&
          item.status === 'cancelling'
        ) {
          item.status = 'cancelled'
        }
      })
      aggregateParentStatuses(state)
    })

    builder.addCase(cancelParentDownloads.rejected, (state, action) => {
      const parentId = action.meta.arg
      state.forEach((item) => {
        if (
          (item.downloadId === parentId || item.parentId === parentId) &&
          item.status === 'cancelling'
        ) {
          item.status = 'cancelled'
        }
      })
      aggregateParentStatuses(state)
    })
  },
})

export const {
  enqueueSession,
  removeQueueItems,
  updateQueueStatus,
  updateQueueItem,
  clearQueueItem,
} = queueSlice.actions
export default queueSlice.reducer

/** Memoized selector factory for queue item by download ID. */
export const selectQueueItemByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.queue], (queue) =>
    queue.find((q) => q.downloadId === downloadId),
  )
