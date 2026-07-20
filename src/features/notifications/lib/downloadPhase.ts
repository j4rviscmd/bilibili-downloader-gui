import type { QueueItem } from '@/shared/queue/queueSlice'

export type DownloadPhase =
  | { phase: 'idle' }
  | { phase: 'active' }
  | { phase: 'settled'; hasSuccess: boolean; hasError: boolean }

/**
 * Derive the download lifecycle phase from the current queue.
 *
 * - `idle`: no children (queue empty or only orphan parents).
 * - `active`: at least one child is pending/running, or any parent is
 *   cancelling.
 * - `settled`: every child reached a terminal state (done/error/cancelled).
 *   `hasSuccess`/`hasError` are derived from children statuses. Cancelled
 *   children do NOT count toward either flag, so a pure all-cancelled
 *   completion returns `hasSuccess=false && hasError=false`, which the
 *   caller uses to skip the completion notification.
 *
 * Pure function — no Redux, no Tauri. Easy to unit-test in isolation.
 */
export function deriveDownloadPhase(queue: QueueItem[]): DownloadPhase {
  const children = queue.filter((q) => q.parentId != null)
  if (children.length === 0) return { phase: 'idle' }

  // Active = any child pending/running OR any parent cancelling. A
  // cancelling parent may have no running children left (see
  // aggregateParentStatuses in queueSlice), so parents are checked
  // separately to keep the flash from firing mid-cancel.
  const hasActiveChild = children.some(
    (c) => c.status === 'running' || c.status === 'pending',
  )
  const hasCancellingParent = queue.some((q) => q.status === 'cancelling')
  if (hasActiveChild || hasCancellingParent) return { phase: 'active' }

  // All children are terminal (done/error/cancelled).
  const hasSuccess = children.some((c) => c.status === 'done')
  const hasError = children.some((c) => c.status === 'error')
  return { phase: 'settled', hasSuccess, hasError }
}
