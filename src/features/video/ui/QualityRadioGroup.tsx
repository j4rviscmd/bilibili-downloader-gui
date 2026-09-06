import { RadioGroupItem } from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { memo, type ReactNode } from 'react'

/** Option for a quality radio button. */
export type QualityRadioOption = {
  id: string
  label: string
  isAvailable: boolean
}

type QualityRadioGroupProps = {
  options: QualityRadioOption[]
  idPrefix: string
  /** Shown on hover when an option is disabled (login / VIP required). */
  unavailableReason?: string
}

/**
 * Radio group component for quality selection.
 *
 * Renders a list of radio buttons for selecting video/audio quality.
 * Unavailable qualities are visually dimmed and disabled; native `title`
 * does not fire on disabled controls, so a tooltip wrapper explains why.
 */
export const QualityRadioGroup = memo(function QualityRadioGroup({
  options,
  idPrefix,
  unavailableReason,
}: QualityRadioGroupProps) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(({ id, label, isAvailable }) => {
        const control = (
          <div
            key={id}
            className={cn(
              'flex min-h-[22px] min-w-[60px] items-center space-x-2 whitespace-nowrap',
              !isAvailable && 'text-muted-foreground/60',
            )}
          >
            <RadioGroupItem
              disabled={!isAvailable}
              value={id}
              id={`${idPrefix}-${id}`}
            />
            <Label
              htmlFor={`${idPrefix}-${id}`}
              className={cn(
                'cursor-pointer',
                !isAvailable && 'cursor-not-allowed',
              )}
            >
              {label}
            </Label>
          </div>
        )

        if (!isAvailable && unavailableReason) {
          return (
            <DisabledQualityTooltip key={id} reason={unavailableReason}>
              {control}
            </DisabledQualityTooltip>
          )
        }

        return control
      })}
    </div>
  )
})

/** Wraps a disabled option so hover reaches the span wrapper, not the
 * disabled control (see CLAUDE.md tooltip pattern). */
function DisabledQualityTooltip({
  reason,
  children,
}: {
  reason: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {reason}
      </TooltipContent>
    </Tooltip>
  )
}
