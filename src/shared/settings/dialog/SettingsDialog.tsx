import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import OutputDirForm from '@/shared/settings/dialog/OutputDirForm'
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
          <div>
            <div>言語</div>
          </div>
          <div>ファイルの上書き</div>
        </div>
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
