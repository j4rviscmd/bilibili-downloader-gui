import { RadioGroupItem } from '@/shared/animate-ui/radix/radio-group'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { memo } from 'react'

/** Option for a quality radio button. */
export type QualityRadioOption = {
  id: string
  label: string
  isAvailable: boolean
}

type QualityRadioGroupProps = {
  options: QualityRadioOption[]
  idPrefix: string
}

/**
 * Radio group component for quality selection.
 *
 * Renders a list of radio buttons for selecting video/audio quality.
 * Unavailable qualities are visually dimmed and disabled.
 */
export const QualityRadioGroup = memo(function QualityRadioGroup({
  options,
  idPrefix,
}: QualityRadioGroupProps) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(({ id, label, isAvailable }) => (
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
      ))}
    </div>
  )
})
