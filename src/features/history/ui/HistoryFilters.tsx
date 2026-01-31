import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/animate-ui/radix/dropdown-menu'
import { useTranslation } from 'react-i18next'

type Props = {
  value: 'all' | 'completed' | 'failed'
  onChange: (value: 'all' | 'completed' | 'failed') => void
}

/**
 * History filter dropdown component.
 *
 * Provides a dropdown menu to filter history entries by status:
 * - "all": Show all entries
 * - "completed": Show only successfully downloaded entries
 * - "failed": Show only failed download entries
 *
 * Labels are internationalized via react-i18next.
 *
 * @example
 * ```tsx
 * <HistoryFilters
 *   value={filter}
 *   onChange={(newValue) => updateFilters({ status: newValue })}
 * />
 * ```
 */
function HistoryFilters({ value, onChange }: Props) {
  const { t } = useTranslation()

  const filterLabels: Record<Props['value'], string> = {
    all: 'history.filterAll',
    completed: 'history.filterSuccess',
    failed: 'history.filterFailed',
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t(filterLabels[value])}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChange('all')}>
          {t(filterLabels.all)}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('completed')}>
          {t(filterLabels.completed)}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('failed')}>
          {t(filterLabels.failed)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default HistoryFilters
