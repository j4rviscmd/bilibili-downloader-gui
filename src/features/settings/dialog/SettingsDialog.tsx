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
