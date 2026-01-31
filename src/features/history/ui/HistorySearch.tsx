import { Input } from '@/shared/ui/input'
import { useTranslation } from 'react-i18next'

/**
 * Props for HistorySearch component.
 */
type Props = {
  /** Current search query value */
  value: string
  /** Callback when search query changes */
  onChange: (value: string) => void
}

/**
 * History search input component.
 *
 * Provides a text input for searching history entries.
 * Search is performed against:
 * - Video titles
 * - URLs
 * - Filenames
 *
 * Placeholder text is internationalized via react-i18next.
 *
 * @example
 * ```tsx
 * <HistorySearch
 *   value={searchQuery}
 *   onChange={(query) => setSearch(query)}
 * />
 * ```
 */
function HistorySearch({ value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <Input
      type="search"
      placeholder={t('history.searchPlaceholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-sm"
    />
  )
}

export default HistorySearch
