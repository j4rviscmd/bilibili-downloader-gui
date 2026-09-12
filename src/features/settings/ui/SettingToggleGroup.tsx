import { InfoTooltip } from '@/features/settings/ui/InfoTooltip'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/animate-ui/radix/toggle-group'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import type { ReactElement } from 'react'

export interface SegmentedChoice {
  value: string
  label: string
  /** Optional Info-icon tooltip next to the segment label */
  tooltip?: string
}

interface SettingToggleGroupProps {
  value: string
  onValueChange: (value: string) => void
  options: readonly SegmentedChoice[]
  /** Additional classes for the ToggleGroup root */
  className?: string
}

/**
 * Segmented control for 2-5 mutually exclusive settings (theme, download
 * parallelism, trim/rotation modes, …).
 *
 * Wraps the animate-ui ToggleGroup (`type="single"`, outlined items) with
 * the settings idiom: an animated active pill slides between segments.
 * Re-clicking the active segment is a no-op (Radix would emit `''`).
 *
 * Tooltips keep the repo convention: a non-interactive info button whose
 * click is suppressed so it never toggles the segment.
 */
export function SettingToggleGroup({
  value,
  onValueChange,
  options,
  className,
}: SettingToggleGroupProps): ReactElement {
  return (
    <TooltipProvider>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => {
          if (next !== '') onValueChange(next)
        }}
        className={cn('w-fit', className)}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            <span className="flex items-center gap-1">
              {option.label}
              {option.tooltip !== undefined && (
                <InfoTooltip text={option.tooltip} />
              )}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </TooltipProvider>
  )
}
