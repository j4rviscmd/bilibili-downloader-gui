import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import { callCancelAllDownloads, callCancelDownload } from './api/cancelApi'

/**
 * Lifecycle state of a single {@linkcode QueueItem}.
 *
 * - `pending` - Enqueued but not yet started by the backend.
 * - `running` - Actively downloading.
 * - `cancelling` - User requested cancellation; awaiting backend confirmation.
 * - `cancelled` - Backend confirmed cancellation via the `download_cancelled` event.
 * - `done` - Download finished successfully.
 * - `error` - Download failed; see `errorMessage` for details.
 */
type QueueItemStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'done'
  | 'error'

/**
 * Aggregates parent queue item statuses based on their children.
 *
 * Updates parent status based on the statuses of all child items with
 * matching parentId. Status priority: error > cancelling > running > done > cancelled > pending.
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

    // Priority: error > cancelling > running > pending > done > cancelled.
    // A pending child means the playlist hasn't finished yet, so a cancelled
    // sibling (from a per-part cancel) must NOT flip the parent to
    // 'cancelled' — that would abort the remaining parts in the serial
    // download loop. Only once every remaining part is done/cancelled does
    // the parent settle to 'cancelled' (or 'done' if nothing was skipped).
    if (statuses.includes('error')) {
      parent.status = 'error'
    } else if (statuses.includes('cancelling')) {
      parent.status = 'cancelling'
    } else if (statuses.includes('running')) {
      parent.status = 'running'
    } else if (statuses.includes('pending')) {
      parent.status = 'pending'
    } else if (statuses.every((s) => s === 'done')) {
      parent.status = 'done'
    } else if (statuses.includes('cancelled')) {
      parent.status = 'cancelled'
    } else {
      parent.status = 'pending'
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
 * Queue item representing a download task.
 */
export type QueueItem = {
  /** Unique download identifier */
  downloadId: string
  /** Optional parent ID for grouping multi-part downloads */
  parentId?: string
  /** Output filename */
  filename?: string
  /** Current status */
  status?: QueueItemStatus
  /** Error message if status is 'error' */
  errorMessage?: string
  /** Output file path (available after download completes) */
  outputPath?: string
  /** Video title */
  title?: string
}

/**
 * Empty initial state for the queue slice. The queue is populated at
 * runtime as downloads are enqueued.
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
 * Redux slice for download queue management.
 *
 * Manages the queue of pending, running, and completed downloads.
 * Automatically updates parent status based on children.
 */
export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    /**
     * Adds a download to the queue.
     * Skips if an item with the same downloadId already exists.
     */
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push({ ...payload, status: payload.status || 'pending' })
      }
      aggregateParentStatuses(state)
    },
    /** Clears all items from the queue. */
    clearQueue() {
      return []
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
  },
})

export const {
  enqueue,
  clearQueue,
  updateQueueStatus,
  updateQueueItem,
  clearQueueItem,
} = queueSlice.actions
export default queueSlice.reducer

/**
 * Finds a completed queue item for a specific part index.
 * Extracts part index from downloadId using regex pattern `-p(\d+)$`.
 *
 * @param partIndex - One-based part number (matches the number in downloadId)
 */
export function findCompletedItemForPart(
  state: RootState,
  partIndex: number,
): QueueItem | undefined {
  return state.queue.find((item) => {
    const match = item.downloadId.match(/-p(\d+)$/)
    return (
      match && parseInt(match[1], 10) === partIndex && item.status === 'done'
    )
  })
}

/**
 * Selects download ID by part index from queue.
 * Extracts part index from downloadId using regex pattern `-p(\d+)$`.
 *
 * @param partIndex - Zero-based part index (will match +1 in downloadId)
 */
export const selectDownloadIdByPartIndex = (
  state: { queue: QueueItem[] },
  partIndex: number,
): string | undefined => {
  // Search from the end: the most recently enqueued part for this index
  // wins. During a re-download, stale items from a prior session (e.g.
  // cancelled children kept for visibility) coexist with the new ones, and
  // resolving to an old downloadId would make the part card show the prior
  // session's state.
  for (let i = state.queue.length - 1; i >= 0; i--) {
    const match = state.queue[i].downloadId.match(/-p(\d+)$/)
    if (match && parseInt(match[1], 10) === partIndex + 1) {
      return state.queue[i].downloadId
    }
  }
  return undefined
}

/** Memoized selector factory for queue item by download ID. */
export const selectQueueItemByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.queue], (queue) =>
    queue.find((q) => q.downloadId === downloadId),
  )

/**
 * Memoized selector to check if any downloads are active.
 * Returns true if any child is running/pending, or parent is cancelling.
 */
export const selectHasActiveDownloads = createSelector(
  [(state: RootState) => state.queue],
  (queue) => {
    const parentIdsWithChildren = new Set(
      queue.map((i) => i.parentId).filter((id): id is string => id != null),
    )

    return queue.some((q) => {
      if (q.parentId) {
        return q.status === 'running' || q.status === 'pending'
      }
      if (q.status === 'cancelling') {
        return true
      }
      if (q.status === 'pending') {
        return parentIdsWithChildren.has(q.downloadId)
      }
      return false
    })
  },
)

/**
 * Memoized selector to check if any downloads are being cancelled.
 * Used to display 'Cancelling...' label on the download button.
 */
export const selectHasCancellingDownloads = createSelector(
  [(state: RootState) => state.queue],
  (queue) => queue.some((q) => q.status === 'cancelling'),
)
