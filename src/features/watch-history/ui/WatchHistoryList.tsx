import CircleIndicator from '@/shared/ui/CircleIndicator'
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
  /** Whether download buttons should be disabled */
  disabled?: boolean
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
  disabled,
}: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleIndicator size="lg" />
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
      style={{ height: '100%' }}
      data={entries}
      itemContent={(_index, entry) => (
        // Why: pr-3 reserves space so the Virtuoso scrollbar gutter does not overlap the right-aligned download button on each WatchHistoryItem.
        <div className="py-1 pr-3">
          <WatchHistoryItem
            entry={entry}
            onDownload={onDownload}
            disabled={disabled}
          />
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
              <CircleIndicator size="md" />
            </div>
          ) : null,
      }}
    />
  )
}
