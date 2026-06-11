import { languages, useSettings, type SupportedLang } from '@/features/settings'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/animate-ui/radix/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Language selection dropdown for the AppBar.
 *
 * Displays a Languages icon that opens a dropdown with available
 * languages. The current language is indicated with a radio
 * indicator. Changes are persisted via the settings hook.
 */
function LanguageSwitcher() {
  const { t } = useTranslation()
  const { settings, updateLanguage, id2Label } = useSettings()

  return (
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-accent/80 text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors"
                aria-label={t('settings.language')}
              >
                <Languages className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={settings.language}
              onValueChange={(val) => updateLanguage(val as SupportedLang)}
            >
              {languages.map((lang) => (
                <DropdownMenuRadioItem key={lang.id} value={lang.id}>
                  {id2Label(lang.id)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent>
          <p>{id2Label(settings.language)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default LanguageSwitcher
