import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import { callCancelAllDownloads, callCancelDownload } from './api/cancelApi'

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

    // Priority: error > cancelling > running > done > cancelled > pending
    if (statuses.includes('error')) {
      parent.status = 'error'
    } else if (statuses.includes('cancelling')) {
      parent.status = 'cancelling'
    } else if (statuses.includes('running')) {
      parent.status = 'running'
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

const initialState: QueueItem[] = []

/**
 * Async thunk to cancel a specific download.
 *
 * Sets the download status to 'cancelling' before calling the backend,
 * then the status will be updated to 'cancelled' via the 'download_cancelled' event.
 *
 * @param downloadId - Unique identifier of the download to cancel
 */
export const cancelDownload = createAsyncThunk(
  'queue/cancelDownload',
  async (downloadId: string, { getState }) => {
    const state = getState() as RootState
    const item = state.queue.find((i) => i.downloadId === downloadId)
    if (!item) {
      throw new Error(`Download not found: ${downloadId}`)
    }

    const cancellableStatuses = ['pending', 'running', 'cancelling']
    if (!cancellableStatuses.includes(item.status || '')) {
      throw new Error(
        `Download is not cancellable: ${downloadId} (status: ${item.status})`,
      )
    }

    const wasCancelled = await callCancelDownload(downloadId)
    return { downloadId, wasCancelled }
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
    const cancellableIds = state.queue
      .filter((i) => i.status === 'pending' || i.status === 'running')
      .map((i) => i.downloadId)

    if (cancellableIds.length === 0) {
      return { count: 0, downloadIds: [] as string[] }
    }

    const count = await callCancelAllDownloads()
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
    /**
     * Removes a download from the queue.
     * Also removes all children if the provided ID is a parent.
     */
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id && i.parentId !== id)
    },
    /** Clears all items from the queue. */
    clearQueue() {
      return []
    },
    /**
     * Updates the status of a queue item.
     * Automatically aggregates parent status based on children.
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
      if (target) {
        target.status = status
        if (errorMessage) target.errorMessage = errorMessage
      }
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
        item.status = 'cancelling'
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
  },
})

export const {
  enqueue,
  dequeue,
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
  return state.queue.find((item) => {
    const match = item.downloadId.match(/-p(\d+)$/)
    return match && parseInt(match[1], 10) === partIndex + 1
  })?.downloadId
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
