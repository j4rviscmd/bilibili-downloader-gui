import { useAppDispatch } from '@/app/store'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { QueueSessionRow } from '@/shared/queue'
import { cancelParentDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { QueuePartRow, QueueStatusBadge } from './QueuePartRow'

/** Formats seconds as M:SS or H:MM:SS. */
function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${m}:${pad(sec)}`
}

type Props = {
  row: QueueSessionRow
}

/**
 * One download session card on `/downloads`: thumbnail, title, aggregated
 * status badge, parts summary, parent-level cancel, and a collapsible list
 * of the session's part rows.
 */
export function QueueParentCard({ row }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { parent, parts } = row

  const parentActive = ['pending', 'running', 'cancelling'].includes(
    parent.status ?? '',
  )

  const completed = parts.filter((p) => p.status === 'done').length
  const total = parts.length

  // Wall-clock elapsed from the parent timestamps (runs while active,
  // freezes on settle) — same rationale as the queue slice's stamps.
  const elapsedSeconds =
    parent.startedAtMs != null
      ? Math.max(
          0,
          ((parent.completedAtMs ?? Date.now()) - parent.startedAtMs) / 1000,
        )
      : 0

  const handleCancelParent = () =>
    dispatch(cancelParentDownloads(parent.downloadId))

  return (
    <Collapsible defaultOpen={parentActive}>
      <div className="bg-card rounded-lg border">
        <div className="flex items-center gap-3 p-3">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {parent.thumbnailUrl ? (
              <img
                src={parent.thumbnailUrl}
                alt=""
                className="h-11 w-20 shrink-0 rounded-md object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="bg-muted flex h-11 w-20 shrink-0 items-center justify-center rounded-md">
                <ImageOff className="text-muted-foreground/50 h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium" title={parent.title}>
                  {parent.title}
                </span>
                <QueueStatusBadge status={parent.status ?? 'pending'} />
              </div>
              <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs tabular-nums">
                <span>{t('queue.parts_completed', { completed, total })}</span>
                {parent.startedAtMs != null && (
                  <span>
                    {t('downloadStatus.elapsed')}{' '}
                    {formatElapsed(elapsedSeconds)}
                  </span>
                )}
              </div>
            </div>
          </CollapsibleTrigger>
          {parentActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelParent}
              className="h-7 shrink-0 px-2 text-xs"
            >
              {t('actions.cancel')}
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <div className="divide-y border-t px-3">
            {parts.map((part) => (
              <QueuePartRow key={part.item.downloadId} row={part} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
