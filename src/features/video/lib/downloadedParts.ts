import type { HistoryEntry } from '@/features/history/model/historySlice'
import { extractContentId } from '@/features/video/lib/utils'
import type { QueueItem } from '@/shared/queue'

/**
 * Collects 0-based part indices that should be skipped by Select All
 * because they already finished downloading.
 *
 * Sources:
 * - Current-session queue items with status `done` (`-pN` in downloadId)
 * - Download history entries for this video (bvid / av{aid} + `?p=`)
 *
 * @param partCount - Number of parts on the current video (out-of-range pages are ignored)
 */
export function collectDownloadedPartIndices({
  queue,
  historyEntries,
  videoBvid,
  partCount,
  firstPartAid,
}: {
  queue: QueueItem[]
  historyEntries: HistoryEntry[]
  videoBvid: string
  partCount: number
  firstPartAid?: number
}): number[] {
  const indices = new Set<number>()
  const inRange = (index: number) => index >= 0 && index < partCount

  for (const item of queue) {
    if (item.status !== 'done') continue
    const match = item.downloadId.match(/-p(\d+)$/)
    if (!match) continue
    const index = parseInt(match[1], 10) - 1
    if (inRange(index)) indices.add(index)
  }

  const videoIds = new Set<string>()
  if (videoBvid) videoIds.add(videoBvid)
  if (firstPartAid != null) videoIds.add(`av${firstPartAid}`)

  for (const entry of historyEntries) {
    if (entry.status !== 'completed') continue
    const entryId = historyEntryVideoId(entry)
    if (!entryId || !videoIds.has(entryId)) continue
    const index = pageFromHistoryUrl(entry.url) - 1
    if (inRange(index)) indices.add(index)
  }

  return [...indices].sort((a, b) => a - b)
}

function historyEntryVideoId(entry: HistoryEntry): string | undefined {
  if (entry.bvid) return entry.bvid
  const extracted = extractContentId(entry.url)
  return extracted?.type === 'video' ? extracted.id : undefined
}

function pageFromHistoryUrl(url: string): number {
  try {
    const page = new URL(url).searchParams.get('p')
    if (!page) return 1
    const parsed = parseInt(page, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  } catch {
    return 1
  }
}
