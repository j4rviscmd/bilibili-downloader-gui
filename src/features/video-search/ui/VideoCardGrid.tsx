import { Badge } from '@/components/ui/badge'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { cn } from '@/shared/lib/utils'
import { Skeleton } from '@/shared/ui/skeleton'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDuration } from '../lib/formatDuration'
import { zoneKeyForTid } from '../lib/zones'
import type { VideoSearchEntry } from '../types'
import { VideoPreviewDialog } from './VideoPreviewDialog'

/** Placeholder card skeletons shown while a feed/search fetch is in
 * flight — same footprint as real cards so the grid does not jump
 * (loading feedback guidance: preserve layout, no instant vanish). */
export function VideoCardSkeletonGrid() {
  return (
    <ul
      className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="hover:bg-accent/50 flex gap-3 rounded-md p-2">
          <Skeleton className="h-[67px] w-[120px] shrink-0 rounded" />
          <div className="flex w-full flex-col gap-1.5 py-0.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Zone (分区) badge on a card: localized main-zone name — sub-zone tids map
 * to their parent so filtered results and badges agree — with the raw API
 * `typename` as fallback for unknown tids. Hidden when both are empty
 * (ad rows can lack zone data).
 */
function ZoneBadge({ typeid, typename }: { typeid: string; typename: string }) {
  const { t } = useTranslation()
  const key = zoneKeyForTid(typeid)
  const label = key ? t(`videoSearch.zones.${key}`) : typename
  if (!label) return null
  return (
    <Badge
      variant="secondary"
      title={label}
      className="max-w-20 shrink-0 truncate px-1.5 text-[10px]"
    >
      {label}
    </Badge>
  )
}

/**
 * Video card grid shared by the keyword search results and the popular
 * feed. Cards hand off to the existing URL-search download flow via
 * `usePendingDownload` (favorites pattern: no cid — resolved downstream by
 * the URL search page); a thumbnail overlay previews the video.
 */
export function VideoCardGrid({ entries }: { entries: VideoSearchEntry[] }) {
  const { t } = useTranslation()
  const handleDownload = usePendingDownload()
  const [preview, setPreview] = useState<VideoSearchEntry | null>(null)

  return (
    <>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.bvid} className="group relative">
            <button
              type="button"
              onClick={() => handleDownload(entry.bvid, null, 1)}
              className={cn(
                'hover:bg-accent/50 focus-visible:ring-ring/50',
                'flex w-full gap-3 rounded-md p-2 text-left transition-colors',
                'outline-none focus-visible:ring-[3px]',
              )}
              aria-label={entry.title}
            >
              <span className="relative shrink-0">
                <img
                  src={entry.cover}
                  alt=""
                  loading="lazy"
                  className="h-[67px] w-[120px] rounded object-cover"
                  draggable={false}
                  // Why: hdslb.com cover CDNs 403 cross-origin referers
                  // (http://localhost:1420) — every cover <img> in the app
                  // sends no-referrer (watch-history, favorites, queue…).
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.src = '/placeholder.png'
                  }}
                />
                {/* Why: pb-[2px] optically centers the digits — measured in
                  the live webview, Noto Sans JP metrics (ascent 13 /
                  descent 3 at 11px) put the digit ink ~0.95px BELOW the
                  pill center; flex/items-center only centers the line box,
                  and the offset is line-height-independent, so a fixed
                  px nudge is the only fix. px (not rem) keeps it stable
                  across the app font-size setting. */}
                <span className="absolute right-1 bottom-1 flex h-[18px] items-center rounded-sm bg-black/75 px-1 pb-[2px] text-[11px] font-medium text-white tabular-nums">
                  {formatDuration(entry.duration)}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 text-sm font-medium">
                  {entry.title}
                </span>
                {/* Why: author + zone + play share ONE meta row — a full page
                  (20 items / 7 grid rows) must fit without a scrollbar at
                  the default 14px app font, so every per-card row counts.
                  Play count pins right (tabular) so author truncates
                  first. */}
                <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="truncate">{entry.author}</span>
                  <ZoneBadge typeid={entry.typeid} typename={entry.typename} />
                  <span className="ml-auto shrink-0 tabular-nums">
                    {entry.play.toLocaleString()}
                  </span>
                </span>
              </span>
            </button>
            {/* Preview trigger — a SIBLING of the card button (interactive
              content cannot nest inside a button) that covers the whole
              thumbnail: card p-2 (8px) + 120×67 thumb → top-2 left-2
              h-[67px] w-[120px]. Hover reveals a dark scrim over the
              thumbnail plus the centered play icon (desktop pointer app,
              media-card convention); keyboard users get the same reveal
              via focus-visible so the control is never undiscoverable. */}
            <button
              type="button"
              onClick={() => setPreview(entry)}
              aria-label={t('videoSearch.previewPlay')}
              className={cn(
                'focus-visible:ring-ring/50',
                'absolute top-2 left-2 z-10 flex h-[67px] w-[120px]',
                'items-center justify-center rounded text-white outline-none',
                'transition',
                'bg-black/0 group-hover:bg-black/40',
                'focus-visible:bg-black/40',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'focus-visible:ring-[3px]',
              )}
            >
              <Play className="size-8 fill-current drop-shadow" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <VideoPreviewDialog entry={preview} onClose={() => setPreview(null)} />
    </>
  )
}
