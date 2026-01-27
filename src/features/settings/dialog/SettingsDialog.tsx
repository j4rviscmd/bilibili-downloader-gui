import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import SettingsForm from '@/features/settings/dialog/SettingsForm'
import { useSettings } from '@/features/settings/useSettings'
import { useTranslation } from 'react-i18next'

/**
 * Settings dialog component.
 *
 * Displays a modal dialog containing the settings form for configuring
 * application preferences such as language and download output directory.
 * The dialog open/close state is managed via the settings Redux slice.
 *
 * @example
 * ```tsx
 * <SettingsDialog />
 * ```
 */
function SettingsDialog() {
  const { settings, updateOpenDialog } = useSettings()
  const { t } = useTranslation()

  return (
    <Dialog
      open={settings.dialogOpen}
      onOpenChange={(open) => updateOpenDialog(open)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.dialog_title')}</DialogTitle>
          <DialogDescription hidden></DialogDescription>
        </DialogHeader>
        <SettingsForm />
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
