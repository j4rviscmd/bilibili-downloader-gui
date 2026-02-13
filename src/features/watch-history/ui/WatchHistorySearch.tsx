import { Input } from '@/shared/ui/input'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** Current search query value */
  value: string
  /** Callback when search query changes */
  onChange: (value: string) => void
}

/**
 * Search input component for filtering watch history entries by title.
 *
 * Performs case-insensitive matching against video titles.
 *
 * @example
 * ```tsx
 * <WatchHistorySearch
 *   value={searchQuery}
 *   onChange={(query) => setSearch(query)}
 * />
 * ```
 */
export function WatchHistorySearch({ value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
      <Input
        type="text"
        placeholder={t('watchHistory.search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  )
}
