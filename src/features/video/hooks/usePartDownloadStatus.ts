import { useMemo } from 'react'
import { useSelector } from 'react-redux'

import type { RootState } from '@/app/store'
import { selectProgressEntriesByDownloadId } from '@/shared/progress/progressSlice'
import {
  selectDownloadIdByPartIndex,
  selectQueueItemByDownloadId,
} from '@/shared/queue/queueSlice'
import type { Progress } from '@/shared/ui/Progress'

/**
 * Result of part download status hook.
 */
export type PartDownloadStatus = {
  /** Download ID for this part */
  downloadId: string | undefined
  /** Current status */
  status: 'pending' | 'running' | 'done' | 'error' | undefined
  /** Error message if status is 'error' */
  errorMessage: string | undefined
  /** Output file path (available after download completes) */
  outputPath: string | undefined
  /** Filename */
  filename: string | undefined
  /** All progress entries for this download */
  progressEntries: Progress[]
  /** Whether download is complete */
  isComplete: boolean
  /** Whether download is currently running */
  isDownloading: boolean
  /** Whether download is pending */
  isPending: boolean
  /** Whether download has an error */
  hasError: boolean
}

/**
 * Hook to get download status for a specific video part.
 *
 * Extracts downloadId from queue using part index, then retrieves
 * queue item and all progress entries for that download.
 *
 * @param partIndex - Zero-based part index
 * @returns Download status for the part
 */
export const usePartDownloadStatus = (
  partIndex: number,
): PartDownloadStatus => {
  const downloadId = useSelector((state: RootState) =>
    selectDownloadIdByPartIndex(state, partIndex),
  )

  const selectQueueItem = useMemo(
    () => selectQueueItemByDownloadId(downloadId ?? ''),
    [downloadId],
  )
  const queueItem = useSelector(selectQueueItem)

  const selectProgressEntries = useMemo(
    () => selectProgressEntriesByDownloadId(downloadId ?? ''),
    [downloadId],
  )
  const progressEntries = useSelector(selectProgressEntries)

  const isComplete = progressEntries.some((p) => p.stage === 'complete')

  return {
    downloadId,
    status: queueItem?.status,
    errorMessage: queueItem?.errorMessage,
    outputPath: queueItem?.outputPath,
    filename: queueItem?.filename,
    progressEntries,
    isComplete,
    isDownloading: queueItem?.status === 'running' && !isComplete,
    isPending: queueItem?.status === 'pending',
    hasError: queueItem?.status === 'error',
  }
}
