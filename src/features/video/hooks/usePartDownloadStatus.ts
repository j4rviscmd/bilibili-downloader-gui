import { useMemo } from 'react'
import { useSelector } from 'react-redux'

import { selectPartItemForVideo } from '@/shared/queue'

/**
 * Queue-only part status for the search page's part cards (issue #691).
 *
 * Resolves the LATEST queue part matching the `videoId`+`cid` pair — never
 * by part index, so a background download of another video can never light
 * this card up, and a re-download's fresh item wins over a prior session's
 * stale one.
 *
 * Deliberately does NOT subscribe to progress entries: the card renders
 * only a status badge (stage detail lives on /downloads), and a progress
 * subscription would re-render every visible card on every download tick.
 */
export type PartQueueStatus = {
  /** Download ID of the latest queue item matching this videoId+cid */
  downloadId: string | undefined
  /** Current status */
  status:
    | 'pending'
    | 'running'
    | 'cancelling'
    | 'cancelled'
    | 'done'
    | 'error'
    | undefined
  /** Error message if status is 'error' */
  errorMessage: string | undefined
  /** Output file path (available after download completes) */
  outputPath: string | undefined
  /** Part title carried by the queue item */
  filename: string | undefined
  /** Whether the part is pending (queued, waiting for its turn) */
  isPending: boolean
  /** Whether the part is currently downloading */
  isDownloading: boolean
  /** Whether the part failed */
  hasError: boolean
  /** Whether the part is being cancelled */
  isCancelling: boolean
  /** Whether the part was cancelled */
  isCancelled: boolean
  /** Whether the part finished successfully */
  isDone: boolean
}

/**
 * Hook to get the queue status for a specific video part.
 *
 * @param videoId - Video ID ('BV...' or 'av...') of the displayed video
 * @param cid - Part CID to match
 * @returns Queue status for the part (no progress detail)
 */
export const usePartDownloadStatus = (
  videoId: string,
  cid: number,
): PartQueueStatus => {
  const selectQueueItem = useMemo(
    () => selectPartItemForVideo(videoId, cid),
    [videoId, cid],
  )
  const queueItem = useSelector(selectQueueItem)

  return {
    downloadId: queueItem?.downloadId,
    status: queueItem?.status,
    errorMessage: queueItem?.errorMessage,
    outputPath: queueItem?.outputPath,
    filename: queueItem?.title,
    isPending: queueItem?.status === 'pending',
    isDownloading: queueItem?.status === 'running',
    hasError: queueItem?.status === 'error',
    isCancelling: queueItem?.status === 'cancelling',
    isCancelled: queueItem?.status === 'cancelled',
    isDone: queueItem?.status === 'done',
  }
}
