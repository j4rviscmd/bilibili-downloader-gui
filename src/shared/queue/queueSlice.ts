import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'

type QueueItemStatus = 'pending' | 'running' | 'done' | 'error'

/**
 * Aggregates parent queue item statuses based on their children.
 *
 * Updates parent status based on the statuses of all child items with
 * matching parentId. Status priority: error > running > done > pending.
 *
 * @param state - Current queue array to modify
 */
function aggregateParentStatuses(state: QueueItem[]): void {
  const parentIds = new Set(
    state.map((i) => i.parentId).filter((id): id is string => id != null),
  )

  parentIds.forEach((parentId) => {
    const parent = state.find((i) => i.downloadId === parentId)
    if (!parent) return

    const children = state.filter((i) => i.parentId === parentId)
    const statuses = children.map((c) => c.status)

    // Priority: error > running > done > pending
    parent.status = statuses.includes('error')
      ? 'error'
      : statuses.includes('running')
        ? 'running'
        : children.length > 0 && statuses.every((s) => s === 'done')
          ? 'done'
          : parent.status || 'pending'
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
     *
     * Skips if an item with the same downloadId already exists.
     *
     * @param state - Current queue state
     * @param action - Action containing the queue item
     */
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push({ ...payload, status: payload.status || 'pending' })
      }
    },
    /**
     * Removes a download from the queue.
     *
     * Also removes all children if the provided ID is a parent.
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID to remove
     */
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id && i.parentId !== id)
    },
    /**
     * Clears all items from the queue.
     */
    clearQueue() {
      return []
    },
    /**
     * Updates the status of a queue item.
     *
     * Automatically aggregates parent status based on children:
     * - If any child is 'error', parent becomes 'error'
     * - Else if any child is 'running', parent becomes 'running'
     * - Else if all children are 'done', parent becomes 'done'
     * - Otherwise, parent becomes 'pending'
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID and new status
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
     *
     * Merges provided fields with existing item data.
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID and fields to update
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
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID to remove
     */
    clearQueueItem(state, action: PayloadAction<string>) {
      return state.filter((i) => i.downloadId !== action.payload)
    },
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
 *
 * Extracts part index from downloadId using regex pattern `-p(\d+)$`.
 * Returns the item if found, matches the part index, and has status 'done'.
 *
 * @param state - Redux root state
 * @param partIndex - One-based part number (matches the number in downloadId)
 * @returns Queue item if found and completed, undefined otherwise
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
 *
 * Extracts part index from downloadId using regex pattern `-p(\d+)$`.
 * Returns the download ID if found and matches the part index.
 *
 * @param state - Redux root state
 * @param partIndex - Zero-based part index (will match +1 in downloadId)
 * @returns Download ID if found, undefined otherwise
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

/**
 * Memoized selector factory for queue item by download ID.
 *
 * @param downloadId - The download ID to find
 * @returns A memoized selector that returns the queue item
 */
export const selectQueueItemByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.queue], (queue) =>
    queue.find((q) => q.downloadId === downloadId),
  )

/**
 * Memoized selector to check if any downloads are active.
 *
 * Returns true if any queue item has status 'running' or 'pending'.
 * Used to disable UI controls during active downloads.
 *
 * @param state - Redux root state
 * @returns true if any downloads are running or pending
 */
export const selectHasActiveDownloads = createSelector(
  [(state: RootState) => state.queue],
  (queue) =>
    queue.some((q) => q.status === 'running' || q.status === 'pending'),
)
