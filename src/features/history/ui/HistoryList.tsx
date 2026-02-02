import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import type { HistoryEntry } from '../model/historySlice'
import HistoryItem from './HistoryItem'

/**
 * Props for the HistoryList component.
 *
 * @property entries - Array of history entries to display
 * @property loading - Whether the history data is currently loading
 * @property onDelete - Callback function when an entry is deleted
 * @property height - Optional height for the virtual scroll container
 */
type Props = {
  entries: HistoryEntry[]
  loading: boolean
  onDelete: (id: string) => void
  height?: string
}

/** Approximate height in pixels for each HistoryItem (used for virtual scrolling) */
const DEFAULT_ITEM_HEIGHT = 120 // Approximate height for each HistoryItem

/**
 * Empty state icon component.
 *
 * Displays a stylized film/grid icon to represent no history entries.
 */
const EmptyStateIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="64"
    height="64"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="opacity-20"
  >
    <path d="M3 3h18M21 3v5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5M21 21v-5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5M3 8h18M12 3v18" />
  </svg>
)

/**
 * History list component with loading, empty states, and virtual scrolling.
 *
 * Features:
 * - Loading state with spinner
 * - Empty state with icon and message
 * - Virtual scrolling for efficient rendering of large lists
 * - Responsive height calculation
 *
 * @example
 * ```tsx
 * <HistoryList
 *   entries={history.entries}
 *   loading={history.loading}
 *   onDelete={(id) => history.remove(id)}
 *   height="calc(100dvh - 2.3rem - 80px)"
 * />
 * ```
 */
function HistoryList({ entries, loading, onDelete, height }: Props) {
  const { t } = useTranslation()

  // Loading state - shows animated text
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          {t('init.initializing')}
        </div>
      </div>
    )
  }

  // Empty state - shows icon and message when no entries exist
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <div className="text-muted-foreground/60 flex size-32 items-center justify-center">
          <EmptyStateIcon />
        </div>
        <p className="text-muted-foreground text-center text-lg">
          {t('history.empty')}
        </p>
      </div>
    )
  }

  // Virtualized list for efficient rendering of large datasets
  return (
    <Virtuoso
      style={{ height }}
      data={entries}
      itemContent={(_index, entry) => (
        <div key={entry.id} className="p-3">
          <HistoryItem entry={entry} onDelete={() => onDelete(entry.id)} />
        </div>
      )}
      defaultItemHeight={DEFAULT_ITEM_HEIGHT}
    />
  )
}

export default HistoryList
