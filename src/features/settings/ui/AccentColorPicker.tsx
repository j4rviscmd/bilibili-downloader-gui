import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { AccentColor } from '@/features/settings/type'
import { ACCENT_COLOR_OPTIONS } from '@/features/settings/ui/accentColors'
import { cn } from '@/shared/lib/utils'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AccentColorPickerProps {
  value: AccentColor
  onValueChange: (value: AccentColor) => void
}

export function AccentColorPicker({
  value,
  onValueChange,
}: AccentColorPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = ACCENT_COLOR_OPTIONS.find((option) => option.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="border-input bg-background hover:bg-accent/50 flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors"
        >
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: current?.swatch }}
          />
          {current && t(current.labelKey)}
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <div className="grid grid-cols-6 gap-1.5" role="group">
          {ACCENT_COLOR_OPTIONS.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onValueChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-1.5 text-center text-[11px] leading-tight transition-colors',
                  active
                    ? 'border-primary bg-accent/50 text-accent-foreground font-medium'
                    : 'hover:bg-accent/50 border-input',
                )}
              >
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: option.swatch }}
                />
                <span className="break-words">{t(option.labelKey)}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
