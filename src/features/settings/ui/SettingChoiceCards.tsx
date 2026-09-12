import { InfoTooltip } from '@/features/settings/ui/InfoTooltip'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import type { ReactElement } from 'react'

export interface CardChoice {
  value: string
  label: string
  /** Muted sub-line under the label (e.g. codec fallback chains) */
  hint?: string
  /** Optional Info-icon tooltip next to the label */
  tooltip?: string
}

interface SettingChoiceCardsProps {
  value: string
  onValueChange: (value: string) => void
  options: readonly CardChoice[]
  /** Tailwind grid column classes, e.g. 'grid-cols-3' */
  columns?: string
}

/**
 * Card selector for a small set of rich choices (video codec priority).
 *
 * Each card is a full-width button: label (+ optional info tooltip) on
 * the first row and a muted hint line below. The selected card is
 * highlighted via `aria-pressed` styling.
 */
export function SettingChoiceCards({
  value,
  onValueChange,
  options,
  columns = 'grid-cols-3',
}: SettingChoiceCardsProps): ReactElement {
  return (
    <TooltipProvider>
      <div className={cn('grid gap-3', columns)} role="group">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onValueChange(option.value)}
              className={cn(
                'cursor-pointer rounded-lg border p-3 text-left text-sm transition-colors',
                active
                  ? 'border-primary bg-accent/50 text-accent-foreground'
                  : 'hover:bg-accent/50 border-input',
              )}
            >
              {/* No whitespace-nowrap: at the minimum window width each
                  card column is ~150px and long labels must wrap instead
                  of spilling out of the card. */}
              <span className="flex flex-wrap items-center gap-1 font-medium">
                {option.label}
                {option.tooltip !== undefined && (
                  <InfoTooltip text={option.tooltip} />
                )}
              </span>
              {option.hint !== undefined && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  {option.hint}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
