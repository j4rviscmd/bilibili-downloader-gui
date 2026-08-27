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
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'

import { useDownloadStatusDialog } from '../hooks/useDownloadStatusDialog'
import {
  selectDownloadStatusDialogOpen,
  selectPartStatusRows,
} from '../model/selectors'
import { OverallProgressBar } from './OverallProgressBar'
import { PartStatusRow } from './PartStatusRow'

/** Approximate height of one compact status row, including vertical padding. */
const PART_STATUS_ROW_HEIGHT = 40

/**
 * ダウンロード状況サマリダイアログ。
 *
 * 各パートのDL状況を一覧表示する。開閉は Redux
 * （downloadStatusDialog slice）で管理し、DL開始時に自動オープン、
 * 外クリック/Xで閉じ、サイドバーから再オープンできる。
 *
 * DialogContent は grid 配置のため、子に min-w-0 を付与しないと
 * （grid item の min-width: auto で）内容が親幅を溢れる。
 * スクロールは Virtuoso に任せ、180+ 行を全部マウントしない。
 * TooltipProvider は PartStatusRow の Tooltip 表示に必要。
 *
 * @why overflow-x-clip + px-1: Virtuoso's scroller still clips a child's
 *   box-shadow at the container edge. Each PartStatusRow's `ring-1` sits 1px
 *   outside its border box, so without `px-1` the left ring — and the row's
 *   left rounded corner — gets clipped. `px-1` reserves a gutter so the ring
 *   renders; `overflow-x-clip` suppresses an implicit horizontal scrollbar.
 */
export function DownloadStatusDialog() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { close } = useDownloadStatusDialog()
  const isOpen = useSelector(selectDownloadStatusDialogOpen)
  const rows = useSelector(selectPartStatusRows)

  const handleCancel = useCallback(
    (downloadId: string, partIndex: number) => {
      dispatch(cancelDownload(downloadId))
      // @why: Mirror the home (VideoPartCard.handleCancel) behavior and
      //   also clear the selection on cancel. Without this, a re-download
      //   would re-fetch this part, contradicting the user's "I don't want
      //   it" intent. partIndex is 1-based, so -1 converts to 0-based.
      dispatch(
        updatePartSelected({
          index: partIndex - 1,
          selected: false,
        }),
      )
    },
    [dispatch],
  )

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col [&>*]:min-w-0">
        <TooltipProvider delayDuration={300}>
          <DialogHeader>
            <DialogTitle>{t('downloadStatus.title')}</DialogTitle>
            <DialogDescription hidden />
          </DialogHeader>
          {rows.length > 0 && <OverallProgressBar />}
          <div
            className={cn(
              'min-h-[22rem] min-w-0 overflow-x-clip px-1',
              rows.length === 0
                ? 'flex items-center justify-center'
                : 'h-[min(70vh,36rem)]',
            )}
          >
            {rows.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                {t('downloadStatus.no_downloads')}
              </p>
            ) : (
              <ErrorBoundary
                fallback={
                  <p className="text-muted-foreground py-4 text-center text-sm">
                    {t('video.download_failed')}
                  </p>
                }
              >
                <Virtuoso
                  style={{ height: '100%' }}
                  data={rows}
                  computeItemKey={(_index, row) => row.downloadId}
                  defaultItemHeight={PART_STATUS_ROW_HEIGHT}
                  increaseViewportBy={160}
                  itemContent={(_index, row) => (
                    <div className="py-0.5">
                      <PartStatusRow
                        part={row}
                        onCancel={() =>
                          handleCancel(row.downloadId, row.partIndex)
                        }
                      />
                    </div>
                  )}
                />
              </ErrorBoundary>
            )}
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
