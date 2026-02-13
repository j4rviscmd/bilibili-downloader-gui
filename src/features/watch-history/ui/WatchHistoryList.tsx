import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import type { WatchHistoryEntry } from '../types'
import { WatchHistoryItem } from './WatchHistoryItem'

type Props = {
  /** Array of watch history entries to display */
  entries: WatchHistoryEntry[]
  /** Whether initial data is loading */
  loading: boolean
  /** Whether more entries are being loaded */
  loadingMore: boolean
  /** Whether there are more entries to load */
  hasMore: boolean
  /** Callback to load more entries when scrolling near bottom */
  onLoadMore: () => void
  /** Callback when user clicks download on an entry */
  onDownload: (entry: WatchHistoryEntry) => void
  /** Fixed height for the list container (e.g., "calc(100dvh - 200px)") */
  height?: string
}

/** Approximate height in pixels for each WatchHistoryItem (used for virtual scrolling) */
const DEFAULT_ITEM_HEIGHT = 100

/**
 * Virtualized list component for watch history entries.
 *
 * Uses react-virtuoso for efficient rendering of large lists with infinite scroll.
 * Automatically loads more entries when scrolling near the bottom.
 *
 * @example
 * ```tsx
 * <WatchHistoryList
 *   entries={entries}
 *   loading={loading}
 *   loadingMore={loadingMore}
 *   hasMore={cursor ? !cursor.isEnd : false}
 *   onLoadMore={fetchMore}
 *   onDownload={handleDownload}
 *   height="calc(100dvh - 2.3rem - 80px)"
 * />
 * ```
 */
export function WatchHistoryList({
  entries,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  onDownload,
  height,
}: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t('watchHistory.empty')}</p>
      </div>
    )
  }

  return (
    <Virtuoso
      style={{ height }}
      data={entries}
      itemContent={(_index, entry) => (
        <div className="py-1">
          <WatchHistoryItem entry={entry} onDownload={onDownload} />
        </div>
      )}
      defaultItemHeight={DEFAULT_ITEM_HEIGHT}
      endReached={() => {
        if (hasMore && !loadingMore) {
          onLoadMore()
        }
      }}
      components={{
        Footer: () =>
          loadingMore ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : null,
      }}
    />
  )
}
