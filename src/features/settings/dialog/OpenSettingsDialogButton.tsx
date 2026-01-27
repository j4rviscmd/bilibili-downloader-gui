import { Settings } from '@/shared/animate-ui/icons/settings'
import { Button } from '@/shared/ui/button'
import { useSettings } from '@/features/settings/useSettings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Button to open the settings dialog.
 *
 * Displays a button with a gear icon that triggers the settings dialog
 * when clicked. The icon animates on hover for visual feedback.
 *
 * @example
 * ```tsx
 * <OpenSettingsDialogButton />
 * ```
 */
function OpenSettingsDialogButton() {
  const [hover, setHover] = useState(false)
  const { updateOpenDialog } = useSettings()
  const { t } = useTranslation()

  return (
    <Button
      className="w-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => updateOpenDialog(true)}
    >
      <Settings animate={hover} />
      {t('settings.title')}
    </Button>
  )
}

export default OpenSettingsDialogButton
