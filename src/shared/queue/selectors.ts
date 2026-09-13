import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import { pickStageData } from './stages'
import type { QueueItem, QueueItemStatus } from './types'

/**
 * Queue-domain selectors (issue #691).
 *
 * Every queue consumer — the bottom bar, /downloads, taskbar progress and
 * the part-card badges — subscribes here instead of reading
 * `state.input`, so background sessions render identically whether or not
 * their video is currently displayed on /search.
 */

/**
 * Builds the active-part dedup key set used by the enqueue-time duplicate
 * guard: parts that are pending/running/cancelling cannot be re-enqueued.
 *
 * Imperative (called from `getState()` in VideoInfoContext.download, not
 * subscribed to), hence a plain function rather than a memoized selector.
 */
export function collectActivePartKeys(queue: QueueItem[]): Set<string> {
  const keys = new Set<string>()
  for (const item of queue) {
    if (item.kind !== 'part' || item.cid == null) continue
    if (!['pending', 'running', 'cancelling'].includes(item.status ?? ''))
      continue
    keys.add(`${item.videoId}:${item.cid}`)
  }
  return keys
}

/** Resolves the effective part status with the isComplete→done override. */
function effectiveStatus(
  item: QueueItem,
  isComplete: boolean,
): QueueItemStatus {
  // @why: When cancel-all lands right after a merge finishes, child.status
  //   becomes 'cancelled' even though the file is actually complete. Override
  //   to 'done' so displays match the real artifact — inherited from the old
  //   selectPartStatusRows behavior.
  return isComplete ? 'done' : (item.status ?? 'pending')
}

/**
 * Memoized selector factory for the LATEST part item matching a
 * `videoId`+`cid` pair (badge scope on VideoPartCard).
 *
 * Searches from the end so the most recently enqueued session wins — during
 * a re-download, items from a prior session (kept for visibility) coexist
 * with the new ones and must not shadow the fresh state.
 */
export const selectPartItemForVideo = (videoId: string, cid: number) =>
  createSelector([(state: RootState) => state.queue], (queue) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i]
      if (
        item.kind === 'part' &&
        item.videoId === videoId &&
        item.cid === cid
      ) {
        return item
      }
    }
    return undefined
  })

/** One part row of `/downloads` (queue item + merged progress view). */
export type QueuePartRow = {
  item: QueueItem
  /** Effective status (isComplete→done override applied). */
  status: QueueItemStatus
  /** Overall part progress 0-100 across the stages it actually runs. */
  percentage: number
  /** CDN-switch / full retry in progress. */
  isRetrying: boolean
  /** Current stage (download/merge/subtitle/complete). */
  stage?: string
  /** Progress entries for PartDownloadProgress reuse. */
  progressEntries: RootState['progress']
}

/** One session (parent) row of `/downloads`. */
export type QueueSessionRow = {
  parent: QueueItem
  /** Child rows, partIndex ascending. */
  parts: QueuePartRow[]
  /** running + pending child count. */
  activeCount: number
}

/**
 * `/downloads` row model: every session (parent) with its part rows, in
 * FIFO order. Titles come from `QueueItem.title` — never from
 * `state.input`, which may belong to a different video.
 */
export const selectQueueSessions = createSelector(
  [(state: RootState) => state.queue, (state: RootState) => state.progress],
  (queue, progress): QueueSessionRow[] => {
    const parents = queue
      .filter((i) => i.kind === 'parent')
      .sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs)

    return parents.map((parent) => {
      const parts = queue
        .filter((i) => i.parentId === parent.downloadId)
        .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0))
        .map((item): QueuePartRow => {
          const progressEntries = progress.filter(
            (p) => p.downloadId === item.downloadId,
          )
          const rep = pickStageData(progressEntries, item.expectedStages)
          return {
            item,
            status: effectiveStatus(item, rep.isComplete),
            percentage: rep.percentage,
            isRetrying: rep.isRetrying,
            stage: rep.stage,
            progressEntries,
          }
        })
      return {
        parent,
        parts,
        activeCount: parts.filter(
          (r) => r.status === 'running' || r.status === 'pending',
        ).length,
      }
    })
  },
)

/** Bottom-bar / taskbar summary across all sessions. */
export type QueueSummary = {
  /** Any part running/pending, or any parent cancelling. */
  hasActive: boolean
  /** Completed part count (mp4 units, cancelled excluded). */
  completedParts: number
  /** Total non-cancelled part count. */
  totalParts: number
  /** Mean progress ratio 0..1 over non-cancelled parts (done = 1). */
  overallRatio: number
  /** Summed transfer rate (KB/s) of running parts, retrying entries excluded. */
  aggregateTransferRate: number
  /** Any running part is in the ffmpeg merge stage (blocks cancel-all). */
  isMerging: boolean
  /** First N active session thumbnails in drain (FIFO) order. */
  activeThumbnails: { downloadId: string; url: string | null; title: string }[]
  /** Active sessions beyond {@linkcode activeThumbnails}. */
  activeSessionRemainder: number
}

/** Max thumbnails the bottom bar avatar-group renders before `+N`. */
const BOTTOM_BAR_THUMBAIL_LIMIT = 5

/**
 * Aggregate summary for the bottom bar and the taskbar progress.
 *
 * Inherits the three rules of the old home-page summary: isComplete
 * overrides status to done, cancelled parts are excluded from totals, and
 * isMerging reflects any running part's merge stage.
 */
export const selectQueueSummary = createSelector(
  [(state: RootState) => state.queue, (state: RootState) => state.progress],
  (queue, progress): QueueSummary => {
    let completedParts = 0
    let totalParts = 0
    let ratioSum = 0
    const runningIds = new Set<string>()
    let isMerging = false

    for (const item of queue) {
      if (item.kind !== 'part') continue
      const entries = progress.filter((p) => p.downloadId === item.downloadId)
      const rep = pickStageData(entries, item.expectedStages)
      const status = effectiveStatus(item, rep.isComplete)
      if (status === 'cancelled') continue
      totalParts++
      if (status === 'done') {
        completedParts++
        ratioSum += 1
      } else {
        ratioSum += rep.percentage / 100
      }
      if (status === 'running') {
        runningIds.add(item.downloadId)
        if (rep.stage === 'merge') isMerging = true
      }
    }

    // Sum transfer rates of running parts only. isRetrying entries report
    // stale rates while no bytes flow — including them would double-count
    // the last pre-retry rate as if it were still being transferred.
    let aggregateTransferRate = 0
    for (const p of progress) {
      if (!runningIds.has(p.downloadId)) continue
      if (p.isRetrying) continue
      aggregateTransferRate += p.transferRate || 0
    }

    const hasActive = computeHasActive(queue)

    const activeParents = queue
      .filter(
        (i) =>
          i.kind === 'parent' &&
          ['pending', 'running', 'cancelling'].includes(i.status ?? ''),
      )
      .sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs)

    return {
      hasActive,
      completedParts,
      totalParts,
      overallRatio: totalParts > 0 ? ratioSum / totalParts : 0,
      aggregateTransferRate,
      isMerging,
      activeThumbnails: activeParents
        .slice(0, BOTTOM_BAR_THUMBAIL_LIMIT)
        .map((p) => ({
          downloadId: p.downloadId,
          url: p.thumbnailUrl ?? null,
          title: p.title,
        })),
      activeSessionRemainder: Math.max(
        0,
        activeParents.length - BOTTOM_BAR_THUMBAIL_LIMIT,
      ),
    }
  },
)

/** True when any part is running/pending, or any parent is cancelling. */
function computeHasActive(queue: QueueItem[]): boolean {
  return queue.some(
    (q) =>
      (q.parentId && (q.status === 'running' || q.status === 'pending')) ||
      (q.kind === 'parent' && q.status === 'cancelling'),
  )
}

/**
 * Memoized selector to check if any downloads are active.
 * Returns true if any part is running/pending, or a parent is cancelling.
 */
export const selectHasActiveDownloads = createSelector(
  [(state: RootState) => state.queue],
  computeHasActive,
)

/**
 * Memoized selector to check if any downloads are being cancelled.
 * Used to display the 'Cancelling...' label on UI affordances.
 */
export const selectHasCancellingDownloads = createSelector(
  [(state: RootState) => state.queue],
  (queue) => queue.some((q) => q.status === 'cancelling'),
)
