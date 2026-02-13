import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useTranslation } from 'react-i18next'

/**
 * Date filter options for watch history.
 * - `all`: Show all entries
 * - `today`: Show entries viewed today
 * - `week`: Show entries viewed in the last 7 days
 * - `month`: Show entries viewed in the last 30 days
 */
export type DateFilter = 'all' | 'today' | 'week' | 'month'

type Props = {
  /** Current selected date filter */
  value: DateFilter
  /** Callback when date filter changes */
  onChange: (value: DateFilter) => void
}

/**
 * Date filter dropdown for watch history entries.
 *
 * Filters entries based on when they were viewed (today, this week, this month, or all time).
 *
 * @example
 * ```tsx
 * <WatchHistoryFilters
 *   value={dateFilter}
 *   onChange={(filter) => setDate(filter)}
 * />
 * ```
 */
export function WatchHistoryFilters({ value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t('watchHistory.filter.all')}</SelectItem>
        <SelectItem value="today">{t('watchHistory.filter.today')}</SelectItem>
        <SelectItem value="week">{t('watchHistory.filter.week')}</SelectItem>
        <SelectItem value="month">{t('watchHistory.filter.month')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
