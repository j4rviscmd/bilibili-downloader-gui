import { useAppDispatch, useSelector } from '@/app/store'
import { updatePartSelected } from '@/features/video/model/inputSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { cancelDownload } from '@/shared/queue'
import { useTranslation } from 'react-i18next'

import { useDownloadStatusDialog } from '../hooks/useDownloadStatusDialog'
import {
  selectDownloadStatusDialogOpen,
  selectPartStatusRows,
} from '../model/selectors'
import { OverallProgressBar } from './OverallProgressBar'
import { PartStatusRow } from './PartStatusRow'

/**
 * ダウンロード状況サマリダイアログ。
 *
 * 各パートのDL状況を一覧表示する。開閉は Redux
 * （downloadStatusDialog slice）で管理し、DL開始時に自動オープン、
 * 外クリック/Xで閉じ、サイドバーから再オープンできる。
 *
 * DialogContent は grid 配置のため、子に min-w-0 を付与しないと
 * （grid item の min-width: auto で）内容が親幅を溢れる。
 * スクロール領域は ScrollArea ではなく overflow-y-auto の div を使い、
 * 内容の max-content に水平に広がらないようにする。
 * TooltipProvider は PartStatusRow の Tooltip 表示に必要。
 */
export function DownloadStatusDialog() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { close } = useDownloadStatusDialog()
  const isOpen = useSelector(selectDownloadStatusDialogOpen)
  const rows = useSelector(selectPartStatusRows)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-w-5xl [&>*]:min-w-0">
        <TooltipProvider delayDuration={300}>
          <DialogHeader>
            <DialogTitle>{t('downloadStatus.title')}</DialogTitle>
            <DialogDescription hidden />
          </DialogHeader>
          {rows.length > 0 && <OverallProgressBar />}
          <div
            className={cn(
              'max-h-[80vh] min-h-[22rem] overflow-y-auto pr-1',
              rows.length === 0 && 'flex items-center justify-center',
            )}
          >
            {rows.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                {t('downloadStatus.no_downloads')}
              </p>
            ) : (
              <div className="space-y-1 py-2">
                {rows.map((row) => (
                  <PartStatusRow
                    key={row.downloadId}
                    part={row}
                    onCancel={() => {
                      dispatch(cancelDownload(row.downloadId))
                      // @why: Mirror the home (VideoPartCard.handleCancel) behavior and
                      //   also clear the selection on cancel. Without this, a re-download
                      //   would re-fetch this part, contradicting the user's "I don't want
                      //   it" intent. partIndex is 1-based, so -1 converts to 0-based.
                      dispatch(
                        updatePartSelected({
                          index: row.partIndex - 1,
                          selected: false,
                        }),
                      )
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
