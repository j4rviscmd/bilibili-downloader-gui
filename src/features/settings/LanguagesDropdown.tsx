import { languages } from '@/features/settings/language/languages'
import { useSettings } from '@/features/settings/useSettings'
import type { SupportedLang } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/animate-ui/radix/dropdown-menu'
import { Button } from '@/shared/ui/button'
import { Languages } from 'lucide-react'
import { motion } from 'motion/react'

/**
 * Dropdown menu for language selection.
 *
 * Displays a button with the current language label and a dropdown
 * containing all available languages (English, Japanese, French, Spanish,
 * Chinese, Korean). When a language is selected, it updates the app
 * settings and applies the new language immediately.
 *
 * @example
 * ```tsx
 * <LanguagesDropdown />
 * ```
 */
function LanguagesDropdown() {
  const { settings, id2Label, updateLanguage } = useSettings()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" asChild>
          <motion.button
            className="max-h-7 min-w-23 shrink-0"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Languages />
            {id2Label(settings.language)}
          </motion.button>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-23">
        <DropdownMenuRadioGroup
          value={settings.language}
          onValueChange={(value) => updateLanguage(value as SupportedLang)}
        >
          {languages.map((lang, idx) => {
            return (
              <DropdownMenuRadioItem key={idx} value={lang.id}>
                {lang.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default LanguagesDropdown
