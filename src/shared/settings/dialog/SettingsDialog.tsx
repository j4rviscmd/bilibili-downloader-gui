import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import SettingsForm from '@/shared/settings/dialog/SettingsForm'
import { useSettings } from '@/shared/settings/useSettings'

function SettingsDialog() {
  const { settings, updateOpenDialog } = useSettings()

  return (
    <Dialog
      open={settings.dialogOpen}
      onOpenChange={(open) => updateOpenDialog(open)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription hidden></DialogDescription>
        </DialogHeader>
        <SettingsForm />
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
