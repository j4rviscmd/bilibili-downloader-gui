import SettingsForm from '@/features/settings/dialog/SettingsForm'
import { useSettings } from '@/features/settings/useSettings'
import { ScrollArea } from '@/shared/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('settings.dialog_title')}</DialogTitle>
          <DialogDescription hidden></DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-100px)] px-4">
          <SettingsForm />
        </ScrollArea>
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
