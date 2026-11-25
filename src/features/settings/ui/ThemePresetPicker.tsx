import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { ThemePreset } from '@/features/settings/type'
import {
  getThemePresetOption,
  ThemePresetGrid,
} from '@/features/settings/ui/ThemePresetGrid'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ThemePresetPickerProps {
  value: ThemePreset
  onValueChange: (value: ThemePreset) => void
}

export function ThemePresetPicker({
  value,
  onValueChange,
}: ThemePresetPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = getThemePresetOption(value)
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
            style={{ backgroundColor: current.swatch }}
          />
          {t(current.labelKey)}
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3">
        <ThemePresetGrid
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
