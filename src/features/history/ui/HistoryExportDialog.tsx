import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import { Label } from '@/shared/ui/label'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Props for HistoryExportDialog component.
 */
type Props = {
  /** Whether the dialog is open */
  open: boolean
  /** Callback to toggle dialog open state */
  onOpenChange: (open: boolean) => void
  /** Callback to execute export with selected format */
  onExport: (format: 'json' | 'csv') => Promise<void>
}

/**
 * History export dialog component.
 *
 * Modal dialog for exporting history data in JSON or CSV format.
 */
function HistoryExportDialog({ open, onOpenChange, onExport }: Props) {
  const { t } = useTranslation()
  const [format, setFormat] = useState<'json' | 'csv'>('json')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await onExport(format)
      onOpenChange(false)
      setFormat('json')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('history.exportTitle')}</DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        <div className="space-y-4 py-4">
          <RadioGroup value={format} onValueChange={(v) => setFormat(v as 'json' | 'csv')}>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="json" id="json" />
              <Label htmlFor="json">{t('history.exportJson')}</Label>
            </div>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="csv" id="csv" />
              <Label htmlFor="csv">{t('history.exportCsv')}</Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? t('video.downloading') : t('actions.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default HistoryExportDialog
