import { LAN_ALL, SUBTITLE_LANGUAGES } from '@/features/video/lib/batchSettings'
import { Checkbox } from '@/shared/animate-ui/radix/checkbox'
import { Label } from '@/shared/ui/label'
import { useTranslation } from 'react-i18next'

interface HardSubtitlePrioritySettingsProps {
  /** Effective priority list (stored settings value or the default). */
  value: readonly string[]
  onChange: (lans: string[]) => void
}

/**
 * Ordered language picker for the hard-sub default priority.
 *
 * Click order defines the priority (badge #1, #2, …). The wildcard
 * option catches parts without any selected language; leaving it off
 * makes the rest of the list strict. The last checked option cannot be
 * unchecked — hard-sub needs at least one pick.
 */
export function HardSubtitlePrioritySettings({
  value,
  onChange,
}: HardSubtitlePrioritySettingsProps) {
  const { t } = useTranslation()

  const toggle = (lan: string, checked: boolean) => {
    if (checked) {
      const next = [...value]
      // Keep specific languages ahead of the wildcard fallback so a newly
      // checked language is always reachable by the burn order.
      const wildIdx = next.indexOf(LAN_ALL)
      next.splice(wildIdx === -1 ? next.length : wildIdx, 0, lan)
      onChange(next)
    } else {
      const next = value.filter((l) => l !== lan)
      if (next.length > 0) onChange(next)
    }
  }

  const options = [
    ...SUBTITLE_LANGUAGES,
    { lan: LAN_ALL, label: t('settings.subtitle_hard_lans_fallback') },
  ]

  return (
    <div className="flex flex-col gap-y-2">
      {options.map(({ lan, label }) => {
        const idx = value.indexOf(lan)
        const checked = idx !== -1
        const id = `hard-lan-${lan === LAN_ALL ? 'all' : lan}`
        return (
          <div key={lan} className="flex min-h-[22px] items-center space-x-2">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(next) => toggle(lan, next === true)}
            />
            <Label
              htmlFor={id}
              className="flex cursor-pointer items-center gap-1"
            >
              {label}
              {checked && (
                <span className="text-muted-foreground text-[10px] font-semibold">
                  {t('search.subtitle_priority', { count: idx + 1 })}
                </span>
              )}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
