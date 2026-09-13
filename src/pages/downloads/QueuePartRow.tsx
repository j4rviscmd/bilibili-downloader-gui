import { useAppDispatch } from '@/app/store'
import { getStatusVisual } from '@/features/video/lib/statusVisual'
import {
  PartDownloadProgress,
  type PartDownloadStatus,
} from '@/features/video/ui/PartDownloadProgress'
import { cn } from '@/shared/lib/utils'
import type { QueuePartRow } from '@/shared/queue'
import { cancelDownload } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { useTranslation } from 'react-i18next'

/** Status badge shared by the part row and the parent card header. */
export function QueueStatusBadge({
  status,
}: {
  status: QueuePartRow['status']
}) {
  const { t } = useTranslation()
  const visual = getStatusVisual(status)
  return (
    <span
      data-status={status}
      className="bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <span
        className={cn('size-1.5 rounded-full', visual.dotClass)}
        aria-hidden
      />
      {t(visual.labelKey)}
    </span>
  )
}

type Props = {
  row: QueuePartRow
}

/**
 * One part row inside a `/downloads` session card.
 *
 * `data-status` keeps the E2E anchor name the abolished compact row used
 * (the row carries the status attribute itself here).
 */
export function QueuePartRow({ row }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { item, status } = row

  const isComplete = row.progressEntries.some((p) => p.stage === 'complete')

  // PartDownloadProgress consumes the hook's status shape; /downloads
  // resolves items by downloadId (not videoId+cid), so assemble the same
  // shape from the row model.
  const partStatus: PartDownloadStatus = {
    downloadId: item.downloadId,
    status,
    errorMessage: item.errorMessage,
    outputPath: item.outputPath,
    filename: item.title,
    progressEntries: row.progressEntries,
    isComplete,
    isDownloading: status === 'running' && !isComplete,
    isPending: status === 'pending',
    hasError: status === 'error',
    isCancelling: status === 'cancelling',
    isCancelled: status === 'cancelled',
  }

  const canCancel = ['pending', 'running'].includes(status)

  const handleCancel = () => {
    if (item.downloadId) dispatch(cancelDownload(item.downloadId))
  }

  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground w-9 shrink-0 text-xs font-medium tabular-nums">
          P{item.partIndex}
        </span>
        <span className="min-w-0 flex-1 truncate" title={item.title}>
          {item.title}
        </span>
        <QueueStatusBadge status={status} />
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
          >
            {t('actions.cancel')}
          </Button>
        )}
      </div>
      <PartDownloadProgress
        status={partStatus}
        hasEmbeddedAudio={
          item.expectedStages ? !item.expectedStages.audioStage : false
        }
        flat
      />
    </div>
  )
}
