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
import { cn } from '@/shared/lib/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (format: 'json' | 'csv') => Promise<void>
}

/**
 * History export dialog component.
 *
 * Modal dialog for exporting history data in different formats:
 * - JSON: Structured data format
 * - CSV: Spreadsheet-compatible format
 *
 * Handles loading state during export and displays errors via toast notifications.
 *
 * @example
 * ```tsx
 * <HistoryExportDialog
 *   open={isExportDialogOpen}
 *   onOpenChange={setIsExportDialogOpen}
 *   onExport={async (format) => {
 *     const data = await history.exportData(format)
 *     downloadFile(data, format)
 *   }}
 * />
 * ```
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
          <DialogDescription hidden></DialogDescription>
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
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
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
