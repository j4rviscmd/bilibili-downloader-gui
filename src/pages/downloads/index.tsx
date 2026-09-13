import { useAppDispatch, useSelector } from '@/app/store'
import { QueueParentCard } from '@/pages/downloads/QueueParentCard'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { PageTemplate } from '@/shared/layout'
import {
  cancelAllDownloads,
  clearFinishedQueueItems,
  selectQueueSessions,
  selectQueueSummary,
} from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { Download, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Downloads page content (issue #691): renders the queue's drain state.
 *
 * Sessions appear in FIFO order; each parent card expands into part rows
 * with per-part cancel and stage detail. Toolbar offers cancel-all and a
 * manual clear of settled sessions (which also clears their progress
 * entries — the old queue-wiping role of clearQueue).
 */
export function DownloadsContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const sessions = useSelector(selectQueueSessions)
  const summary = useSelector(selectQueueSummary)

  const hasSettled = sessions.some(
    (s) =>
      s.parts.length > 0 &&
      s.parts.every((p) => ['done', 'cancelled', 'error'].includes(p.status)),
  )

  const handleCancelAll = () => {
    dispatch(cancelAllDownloads())
  }

  const handleClearFinished = () => {
    dispatch(clearFinishedQueueItems())
  }

  return (
    <PageTemplate
      title={t('queue.title')}
      description={t('queue.description')}
      actions={
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/*
                  A span wrapper is required: a disabled button gets
                  pointer-events: none and hover never reaches it.
                */}
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelAll}
                    disabled={!summary.hasActive || summary.isMerging}
                  >
                    {t('downloadStatus.cancel_all')}
                  </Button>
                </span>
              </TooltipTrigger>
              {/*
                @why: cancel during the ffmpeg merge stage races the child
                  process (same rationale as the isMerging guard inherited
                  from the old status bar; full doc in the queue summary's
                  isMerging field).
              */}
              {summary.isMerging && (
                <TooltipContent side="bottom">
                  {t('downloadStatus.cancel_all_disabled_merging')}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearFinished}
            disabled={!hasSettled}
          >
            <Trash2 className="mr-1 size-3.5" />
            {t('queue.clear_finished')}
          </Button>
        </div>
      }
    >
      {sessions.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="bg-muted flex size-14 items-center justify-center rounded-full">
            <Download className="text-muted-foreground size-6" />
          </div>
          <p className="text-muted-foreground max-w-sm text-sm whitespace-pre-line">
            {t('queue.empty')}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
          {sessions.map((row) => (
            <QueueParentCard key={row.parent.downloadId} row={row} />
          ))}
        </div>
      )}
    </PageTemplate>
  )
}

export default DownloadsContent
