import { useSettings } from '@/features/settings/useSettings'
import { Settings } from '@/shared/animate-ui/icons/settings'
import { SidebarMenuButton } from '@/shared/animate-ui/radix/sidebar'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Button to open the settings dialog.
 *
 * Displays a button with a gear icon that triggers the settings dialog
 * when clicked. The icon animates on hover for visual feedback.
 *
 * Uses SidebarMenuButton to properly adapt to sidebar's collapsible states.
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
    <SidebarMenuButton
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => updateOpenDialog(true)}
      tooltip={t('settings.title')}
    >
      <Settings animate={hover} />
      <span>{t('settings.title')}</span>
    </SidebarMenuButton>
  )
}

export default OpenSettingsDialogButton
