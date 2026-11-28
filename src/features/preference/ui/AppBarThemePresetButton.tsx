import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useSettings } from '@/features/settings'
import {
  getThemePresetOption,
  ThemePresetGrid,
} from '@/features/settings/ui/ThemePresetGrid'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Palette } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Theme-preset palette button for the AppBar, next to the light/dark
 * switch. Hidden when settings ≫ showAppBarThemePreset is off; the
 * popover reuses the settings page's ThemePresetGrid.
 */
function AppBarThemePresetButton() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()
  const [open, setOpen] = useState(false)

  if (settings.showAppBarThemePreset === false) return null

  const current = getThemePresetOption(settings.themePreset ?? 'bilibili')
  return (
    <TooltipProvider>
      <Tooltip>
        <Popover open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="appbar-theme-preset-button"
                // Why: dark:hover:text-accent-foreground — hover paints
                // bg-accent/80, and most tweakcn dark presets have a light
                // accent there, so the default hover text (foreground) falls
                // below readable contrast; accent-foreground is the token
                // designed to pair with accent (issue #995, guarded by the
                // hover contrast test in scripts/generate-theme-presets.test.ts).
                className="hover:bg-accent/80 text-muted-foreground hover:text-foreground dark:hover:text-accent-foreground flex size-7 items-center justify-center rounded-md transition-colors"
                aria-label={t('settings.themePreset_label')}
              >
                <Palette className="size-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent align="end" className="w-96 p-3">
            <ThemePresetGrid
              value={settings.themePreset ?? 'bilibili'}
              onValueChange={(value) => {
                // Silent: the whole UI recoloring is its own feedback —
                // matches the app-bar language switcher's silent save.
                void saveByForm({ themePreset: value }, true)
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
        <TooltipContent>
          <p>{t(current.labelKey)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default AppBarThemePresetButton
