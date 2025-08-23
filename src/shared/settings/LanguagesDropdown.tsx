import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/animate-ui/radix/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { SupportedLang } from '@/i18n'
import { languages } from '@/shared/settings/language/languages'
import { useSettings } from '@/shared/settings/useSettings'
import { Languages } from 'lucide-react'
import { motion } from 'motion/react'

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
