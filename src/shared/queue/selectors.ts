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

/**
 * `/downloads` row model: every part FLAT, in drain order — sessions
 * (enqueue clicks) are deliberately NOT grouped visually: the replace
 * semantics already spread one video's parts across sessions, and the
 * post-MVP part-reorder feature needs a part-granular list. Order matches
 * the runner's pick order (session FIFO, then partIndex). Titles come from
 * `QueueItem.title` — never from `state.input`, which may belong to a
 * different video.
 */
export const selectQueuePartRows = createSelector(
  [(state: RootState) => state.queue, (state: RootState) => state.progress],
  (queue, progress): QueuePartRow[] => {
    const parents = new Map(
      queue
        .filter((i) => i.kind === 'parent')
        .map((p) => [p.downloadId, p] as const),
    )
    // Orphan parts (parent pruned mid-flight — clearFinished removes
    // both together, so this is defensive) are unreachable for the runner
    // and dropped from the list rather than sorted to the top.
    return queue
      .filter((i) => i.kind === 'part')
      .map((item) => ({ item, parent: parents.get(item.parentId ?? '') }))
      .filter((entry) => entry.parent !== undefined)
      .sort((a, b) => {
        const pa = a.parent?.enqueuedAtMs ?? 0
        const pb = b.parent?.enqueuedAtMs ?? 0
        if (pa !== pb) return pa - pb
        return (a.item.partIndex ?? 0) - (b.item.partIndex ?? 0)
      })
      .map(({ item }): QueuePartRow => {
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
  },
)

/** Bottom-bar / taskbar summary across all sessions. */
export type QueueSummary = {
  /** Any part running/pending, or any parent cancelling. */
  hasActive: boolean
  /**
   * ANY queue item exists (active or settled). The bottom bar stays
   * mounted while this is true — it only hides on a fully empty queue, so
   * the bar never pops in/out mid-use (layout shift) and finished entries
   * keep a permanent affordance until Clear Finished empties the queue.
   */
  hasAnyItems: boolean
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
  /**
   * First N active PART thumbnails in drain (FIFO) order — per part, not
   * per session: enqueuing several parts must visibly add several avatars
   * (bangumi episodes carry distinct thumbnails). Ordered by session FIFO,
   * then partIndex within a session.
   */
  activeThumbnails: { downloadId: string; url: string | null; title: string }[]
  /** Active parts beyond {@linkcode activeThumbnails}. */
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

    // Flatten the active sessions' ACTIVE parts (FIFO, partIndex within a
    // session) — one avatar per part.
    const activeParts: {
      downloadId: string
      url: string | null
      title: string
    }[] = []
    for (const parent of activeParents) {
      for (const part of queue
        .filter(
          (i) =>
            i.parentId === parent.downloadId &&
            ['pending', 'running', 'cancelling'].includes(i.status ?? ''),
        )
        .sort((a, b) => (a.partIndex ?? 0) - (b.partIndex ?? 0))) {
        activeParts.push({
          downloadId: part.downloadId,
          url: part.thumbnailUrl ?? parent.thumbnailUrl ?? null,
          title: part.title,
        })
      }
    }

    return {
      hasActive,
      hasAnyItems: queue.length > 0,
      completedParts,
      totalParts,
      overallRatio: totalParts > 0 ? ratioSum / totalParts : 0,
      aggregateTransferRate,
      isMerging,
      activeThumbnails: activeParts.slice(0, BOTTOM_BAR_THUMBAIL_LIMIT),
      activeSessionRemainder: Math.max(
        0,
        activeParts.length - BOTTOM_BAR_THUMBAIL_LIMIT,
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
