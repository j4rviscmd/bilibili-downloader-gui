import { TWEAKCN_THEME_PRESETS } from '@/features/settings/themePresets'
import type { ThemePreset } from '@/features/settings/type'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from 'react-i18next'

interface ThemePresetOption {
  id: ThemePreset
  labelKey: string
  swatch: string
}

// The bilibili pair is hand-defined (brand colorways); the 42 tweakcn
// presets come from the generated themePresets.ts.
const THEME_PRESET_OPTIONS: readonly ThemePresetOption[] = [
  { id: 'bilibili', labelKey: 'settings.theme_bilibili', swatch: '#fb7299' },
  {
    id: 'bilibili-blue',
    labelKey: 'settings.theme_bilibili-blue',
    swatch: '#00aeec',
  },
  ...TWEAKCN_THEME_PRESETS,
]

export function getThemePresetOption(value: ThemePreset): ThemePresetOption {
  // Unknown ids (hand-edited settings.json) render as the bilibili
  // default — the CSS falls back the same way (no preset attribute).
  return (
    THEME_PRESET_OPTIONS.find((option) => option.id === value) ??
    THEME_PRESET_OPTIONS[0]
  )
}

interface ThemePresetGridProps {
  value: ThemePreset
  onValueChange: (value: ThemePreset) => void
  /** Grid overrides, e.g. a different column count (default 6). */
  className?: string
}

export function ThemePresetGrid({
  value,
  onValueChange,
  className,
}: ThemePresetGridProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'grid max-h-80 grid-cols-6 gap-1.5 overflow-y-auto',
        className,
      )}
      role="group"
    >
      {THEME_PRESET_OPTIONS.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`theme-preset-${option.id}`}
            aria-pressed={active}
            onClick={() => onValueChange(option.id)}
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
            <span className="w-full break-words">{t(option.labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
