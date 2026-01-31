import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/animate-ui/radix/dropdown-menu'
import { useTranslation } from 'react-i18next'

/**
 * Props for HistoryFilters component.
 */
type Props = {
  /** Current filter value */
  value: 'all' | 'completed' | 'failed'
  /** Callback when filter value changes */
  onChange: (value: 'all' | 'completed' | 'failed') => void
}

/**
 * History filter dropdown component.
 *
 * Provides a dropdown menu to filter history entries by status.
 */
function HistoryFilters({ value, onChange }: Props) {
  const { t } = useTranslation()

  const label = (status: Props['value']) => {
    switch (status) {
      case 'all':
        return 'history.filterAll'
      case 'completed':
        return 'history.filterSuccess'
      case 'failed':
        return 'history.filterFailed'
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t(label(value))}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChange('all')}>
          {t(label('all'))}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('completed')}>
          {t(label('completed'))}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('failed')}>
          {t(label('failed'))}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default HistoryFilters
