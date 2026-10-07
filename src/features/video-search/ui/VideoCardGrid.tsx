import { Badge } from '@/components/ui/badge'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { cn } from '@/shared/lib/utils'
import { Skeleton } from '@/shared/ui/skeleton'
import { Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDuration } from '../lib/formatDuration'
import { zoneKeyForTid } from '../lib/zones'
import type { VideoSearchEntry } from '../types'
import { VideoPreviewDialog } from './VideoPreviewDialog'

/** Grid + card layout of one card variant. `featured` renders the
 * "For you" shelf: one column fewer per breakpoint and the same
 * horizontal card as the default, but with a 208px (w-52) aspect-video
 * thumbnail — ~3× the default's 120×67 thumb area while keeping rows
 * compact (title beside the thumbnail, not under it). */
type CardVariant = 'default' | 'featured'

const GRID_CLASSES: Record<CardVariant, string> = {
  default: 'grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3',
  featured: 'grid grid-cols-1 gap-3 xl:grid-cols-2',
}

/** Placeholder card skeletons shown while a feed/search fetch is in
 * flight — same footprint as real cards so the grid does not jump
 * (loading feedback guidance: preserve layout, no instant vanish). */
export function VideoCardSkeletonGrid({
  variant = 'default',
}: {
  variant?: CardVariant
}) {
  const featured = variant === 'featured'
  return (
    <ul className={GRID_CLASSES[variant]} aria-hidden="true">
      {Array.from({ length: featured ? 4 : 6 }, (_, i) => (
        <li key={i} className="hover:bg-accent/50 flex gap-3 rounded-md p-2">
          <Skeleton
            className={cn(
              'shrink-0 rounded',
              featured ? 'aspect-video w-52' : 'h-[67px] w-[120px]',
            )}
          />
          <div className="flex w-full flex-col gap-1.5 py-0.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
            {/* Featured cards carry a third meta line (play count). */}
            {featured && <Skeleton className="h-3 w-1/4" />}
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
 * Recommendation reason chip (home feed's `rcmd_reason`, e.g. "高点赞量")
 * — the personalization signal of the featured shelf. Hidden when the
 * API gave no reason, same policy as the zone badge.
 */
function ReasonBadge({ reason }: { reason?: string }) {
  if (!reason) return null
  return (
    <Badge
      variant="secondary"
      title={reason}
      className="max-w-24 shrink-0 gap-1 truncate px-1.5 text-[10px]"
    >
      <Sparkles className="size-3 shrink-0" aria-hidden="true" />
      {reason}
    </Badge>
  )
}

/**
 * Video card grid shared by the keyword search results, the popular feed,
 * and the featured "For you" shelf (`variant="featured"`). Cards hand off
 * to the existing URL-search download flow via `usePendingDownload`
 * (favorites pattern: no cid — resolved downstream by the URL search
 * page); a thumbnail overlay previews the video.
 */
export function VideoCardGrid({
  entries,
  variant = 'default',
}: {
  entries: VideoSearchEntry[]
  variant?: CardVariant
}) {
  const { t } = useTranslation()
  const featured = variant === 'featured'
  const handleDownload = usePendingDownload()
  const [preview, setPreview] = useState<VideoSearchEntry | null>(null)

  return (
    <>
      <ul className={GRID_CLASSES[variant]}>
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
                  className={cn(
                    'rounded object-cover',
                    featured ? 'aspect-video w-52' : 'h-[67px] w-[120px]',
                  )}
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
                {/* Why author + zone + play share ONE meta row on the
                  default card — a full page (20 items / 7 grid rows) must
                  fit without a scrollbar at the default 14px app font.
                  The featured card has room beside its 117px thumbnail, so
                  the play count gets its own third line instead of
                  pinning right and truncating the author. */}
                <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="truncate">{entry.author}</span>
                  <ReasonBadge reason={entry.recommendReason} />
                  <ZoneBadge typeid={entry.typeid} typename={entry.typename} />
                  {!featured && (
                    <span className="ml-auto shrink-0 tabular-nums">
                      {entry.play.toLocaleString()}
                    </span>
                  )}
                </span>
                {featured && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {entry.play.toLocaleString()}
                  </span>
                )}
              </span>
            </button>
            {/* Preview trigger — a SIBLING of the card button (interactive
              content cannot nest inside a button) that covers the whole
              thumbnail: card p-2 (8px) + thumb box → top-2 left-2 plus
              the variant's thumb size (featured 208×117 via aspect-video,
              default 120×67). Hover reveals a dark scrim over the
              thumbnail plus the centered play icon (desktop pointer app,
              media-card convention); keyboard users get the same reveal
              via focus-visible so the control is never undiscoverable. */}
            <button
              type="button"
              onClick={() => setPreview(entry)}
              aria-label={t('videoSearch.previewPlay')}
              className={cn(
                'focus-visible:ring-ring/50',
                'absolute top-2 left-2 z-10 flex',
                featured ? 'aspect-video w-52' : 'h-[67px] w-[120px]',
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
