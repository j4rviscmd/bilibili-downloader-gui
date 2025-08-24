import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import { Separator } from '@/components/ui/separator'
import OutputDirForm from '@/shared/settings/dialog/SettingsForm'
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
        <div className="flex flex-col gap-3">
          <OutputDirForm />
          <Separator />
          <div>言語</div>
          <Separator />
          <div>ファイルの上書き</div>
        </div>
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
