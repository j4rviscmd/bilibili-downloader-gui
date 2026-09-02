import SettingsForm from '@/features/settings/dialog/SettingsForm'
import { useSettings } from '@/features/settings/useSettings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { logger } from '@/shared/lib/logger'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { useEffect } from 'react'
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
  const { settings, updateOpenDialog, getSettings } = useSettings()
  const { t } = useTranslation()

  // Why: settings.json is shared across app instances (issue #560); another
  // instance may have saved newer values after this window's snapshot.
  // Re-read the file on open so the form shows the latest values and a save
  // can never silently overwrite the other instance's changes with stale ones.
  // Remaining gap: changes saved by another instance WHILE this form is open
  // are still overwritten on submit — TODO(#563) removes the race via a
  // partial-update settings API.
  useEffect(() => {
    if (settings.dialogOpen) {
      getSettings().catch((e) => {
        logger.warn(`SettingsDialog: refresh on open failed: ${String(e)}`)
      })
    }
  }, [settings.dialogOpen, getSettings])

  return (
    <Dialog
      open={settings.dialogOpen}
      onOpenChange={(open) => updateOpenDialog(open)}
    >
      <DialogContent className="max-w-5xl">
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
