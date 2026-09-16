import { useAppDispatch, useSelector } from '@/app/store'
import { QueuePartRow } from '@/pages/downloads/QueuePartRow'
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
  selectQueuePartRows,
  selectQueueSummary,
  type QueuePartRow as QueuePartRowModel,
} from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { Download } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Downloads page content (issue #691): renders the queue's drain state as
 * a FLAT part list split into three sections — Downloading / Queued /
 * Finished (done·cancelled·error) — each in drain order. Enqueue clicks
 * are not grouped: the replace semantics already spread one video's parts
 * across sessions, and the post-MVP part-reorder feature needs part
 * granularity. Each row carries its own cancel and stage detail. The
 * toolbar offers cancel-all and a manual clear of settled parts (which
 * also clears their progress entries — the old queue-wiping role of
 * clearQueue).
 */
export function DownloadsContent() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const rows = useSelector(selectQueuePartRows)
  const summary = useSelector(selectQueueSummary)

  // Section split (verification decision): downloading (incl. the brief
  // cancelling window — still in flight until the backend confirms),
  // queued, and settled (done/cancelled/error). Rows keep their drain
  // order within a section.
  const sections = useMemo(() => {
    const downloading: QueuePartRowModel[] = []
    const queued: QueuePartRowModel[] = []
    const settled: QueuePartRowModel[] = []
    for (const row of rows) {
      if (row.status === 'running' || row.status === 'cancelling') {
        downloading.push(row)
      } else if (row.status === 'pending') {
        queued.push(row)
      } else {
        settled.push(row)
      }
    }
    return [
      { key: 'section_downloading', rows: downloading },
      { key: 'section_queued', rows: queued },
      { key: 'section_finished', rows: settled },
    ].filter((section) => section.rows.length > 0)
  }, [rows])

  const hasSettled = rows.some((r) =>
    ['done', 'cancelled', 'error'].includes(r.status),
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
                  onFocus blur: entering /downloads sometimes focuses this
                  first focusable element and Radix opened the tooltip
                  with no cursor near it (verification feedback) — blur
                  keeps the tooltip hover-only.
                */}
                <span onFocus={(e) => e.currentTarget.blur()}>
                  {/* Ghost: destructive/secondary utilities — an outline
                      button read as a primary action and pulled the eye
                      (verification feedback); anyone NOT using them should
                      look past these. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelAll}
                    disabled={!summary.hasActive || summary.isMerging}
                    className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
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
            variant="ghost"
            size="sm"
            onClick={handleClearFinished}
            disabled={!hasSettled}
            className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
          >
            {t('queue.clear_finished')}
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="bg-muted flex size-14 items-center justify-center rounded-full">
            <Download className="text-muted-foreground size-6" />
          </div>
          <p className="text-muted-foreground max-w-sm text-sm whitespace-pre-line">
            {t('queue.empty')}
          </p>
        </div>
      ) : (
        /* pr-5 reserves space so the scrollbar gutter does not overlap the
           rows (pattern from issue #700). */
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-3 pr-5">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="text-muted-foreground mb-1 px-1 text-xs font-semibold tracking-wide uppercase">
                {t(`queue.${section.key}`)}
                <span className="ml-1.5 tabular-nums">
                  ({section.rows.length})
                </span>
              </h2>
              <div className="divide-y">
                {section.rows.map((row) => (
                  <QueuePartRow key={row.item.downloadId} row={row} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageTemplate>
  )
}

export default DownloadsContent
