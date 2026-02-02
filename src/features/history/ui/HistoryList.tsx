import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import type { HistoryEntry } from '../model/historySlice'
import HistoryItem from './HistoryItem'

/**
 * Props for HistoryList component.
 */
type Props = {
  /** Array of history entries to display */
  entries: HistoryEntry[]
  /** Loading state indicator */
  loading: boolean
  /** Callback when delete button is clicked */
  onDelete: (id: string) => void
  /** Height for the virtual list container */
  height?: string
}

/**
 * History list component with loading, empty states, and virtual scrolling.
 *
 * Displays history entries in a scrollable list with:
 * - Loading spinner while fetching data
 * - Empty state illustration when no entries exist
 * - Virtual scrolling for optimal performance with large lists
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

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          {t('init.initializing')}
        </div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <div className="text-muted-foreground/60 flex size-32 items-center justify-center">
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
        </div>
        <p className="text-muted-foreground text-center text-lg">
          {t('history.empty')}
        </p>
      </div>
    )
  }

  return (
    <Virtuoso
      style={{ height }}
      data={entries}
      itemContent={(_index, entry) => (
        <div key={entry.id} className="p-3">
          <HistoryItem entry={entry} onDelete={() => onDelete(entry.id)} />
        </div>
      )}
      defaultItemHeight={120} // Approximate height for each HistoryItem
    />
  )
}

export default HistoryList
