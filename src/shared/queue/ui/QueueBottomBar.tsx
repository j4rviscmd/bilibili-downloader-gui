import { useSelector } from '@/app/store'
import {
  AvatarGroup,
  AvatarGroupTooltip,
} from '@/components/animate-ui/components/animate/avatar-group'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AnimatedSection } from '@/shared/animate-ui/effects/animated-section'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { selectQueueSummary } from '../selectors'
import { SpeedLimitLink, formatKbps } from './SpeedLimitLink'

/**
 * Bottom download bar (issue #691, Steam-like), mounted once in
 * PageLayoutShell so it survives page navigation.
 *
 * Visible while the queue holds ANY item (`hasAnyItems`): overall
 * progress across every session, completed mp4 count (`12/38`), summed
 * transfer rate, the speed-limit link, and an avatar-group of the active
 * PARTS' thumbnails (FIFO head, up to 5, then `+N` — one avatar per part,
 * so enqueuing several parts adds several avatars). The whole area
 * navigates to `/downloads` — cancellation lives there, deliberately not
 * here.
 *
 * Eye guidance (issue #691 comment 3): the enqueue site (DownloadButton)
 * launches a fly-to-bar thumbnail animation toward the avatar area
 * (`data-queue-avatar-target`, consumed by ThumbnailFlightLayer); the
 * first enqueue additionally animates the bar in via AnimatedSection's
 * height spring, and each new thumbnail pops in (zoom-in).
 */
export function QueueBottomBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const summary = useSelector(selectQueueSummary)

  const percent = Math.min(100, Math.round(summary.overallRatio * 100))

  const openDownloads = () => navigate('/downloads')

  // AvatarGroup's children prop is typed as a single ReactElement[] (one
  // array child), so the avatar list is assembled as an expression instead
  // of JSX sibling children.
  const avatars: React.ReactElement[] = summary.activeThumbnails.map(
    (thumb) => (
      <Avatar
        key={thumb.downloadId}
        // zoom-in pop: a freshly enqueued session's thumbnail animates in,
        // steering the user's eyes to the bar (issue #691 comment intent).
        className="border-background animate-in zoom-in-50 size-8 rounded-lg border-2 duration-500"
      >
        <AvatarImage
          src={thumb.url ?? undefined}
          referrerPolicy="no-referrer"
        />
        <AvatarFallback className="rounded-lg">
          <Download className="size-3.5" />
        </AvatarFallback>
        <AvatarGroupTooltip>{thumb.title}</AvatarGroupTooltip>
      </Avatar>
    ),
  )
  if (summary.activeSessionRemainder > 0) {
    avatars.push(
      <Avatar
        key="__remainder"
        className="border-background bg-muted animate-in zoom-in-50 size-8 rounded-lg border-2 duration-500"
      >
        <AvatarFallback className="rounded-lg text-xs font-medium">
          +{summary.activeSessionRemainder}
        </AvatarFallback>
      </Avatar>,
    )
  }

  // Persistent while the queue holds anything (active or settled):
  // appearing/disappearing mid-use jiggled every page's layout; the bar
  // only hides on a fully empty queue (pre-first-download or after Clear
  // Finished).
  return (
    <AnimatedSection show={summary.hasAnyItems}>
      <div
        data-testid="queue-bottom-bar"
        role="button"
        tabIndex={0}
        aria-label={t('queue.open_downloads')}
        onClick={openDownloads}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openDownloads()
        }}
        className="bg-background/95 supports-backdrop-filter:bg-background/75 pointer-events-auto cursor-pointer border-t px-4 py-2 backdrop-blur"
      >
        {/* Three-zone grid: the progress bar + count sit in the CENTER
            column so the bar reads visually centered — a plain flex-1 bar
            with the fixed-width right cluster (rate/link/avatars) looked
            pushed left. The bar itself is capped (min(38vw, 28rem)) per
            the verification feedback that shortening is acceptable. */}
        {/* Symmetric ratio tracks (1fr/3fr/1fr): the center track — and
            with it the progress bar (flex-1 inside) — stretches dynamically
            to fill leftover width while staying perfectly centered; side
            content changes (rate digits, limit icon) are absorbed by their
            own 1fr tracks and never move the bar. */}
        <div className="mx-auto grid w-full max-w-5xl grid-cols-[1fr_3fr_1fr] items-center gap-3">
          {/* Left zone (flexible, min-w-0): rate + speed-limit live LEFT of
              the bar so the right zone stays avatars-only — the two 1fr
              tracks keep the center cluster centered no matter how the
              rate/limit content changes. NOT fixed-width: at the max app
              font size fixed side zones plus a wide center overflowed and
              clipped the avatars, so the zones flex and shrink instead. */}
          {/* justify-end: the cluster hugs the bar — icon leftmost, rate
              immediately left of the bar — so the layout reads the same
              whether the limit is on or off (verification feedback). */}
          <div className="flex min-w-0 items-center justify-end gap-3">
            {/* Always rendered (blank when idle) so the zone width never
                changes across idle ⇄ active. */}
            <span className="text-muted-foreground min-w-[9ch] text-right text-sm whitespace-nowrap tabular-nums">
              {summary.aggregateTransferRate > 0
                ? formatKbps(summary.aggregateTransferRate)
                : ''}
            </span>
            {/* Speed-limit control only while a download is in progress —
                that is when a limit change applies live. When idle the
                icon floated alone next to the blank rate; Settings remains
                the entry point then. Internal affordance: must not trigger
                the bar's navigation. Right of the rate, adjacent to the
                bar (verification: the fixed-width rate near the bar keeps
                the toggle from shifting the bar-adjacent layout). */}
            {summary.hasActive && (
              <span
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="contents"
              >
                <SpeedLimitLink />
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <Download className="text-muted-foreground size-4 shrink-0" />
            <div className="bg-primary/20 relative h-2 min-w-16 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-[width] duration-1000 ease-linear"
                style={{ width: `${percent}%` }}
              />
            </div>
            {/* Fixed min-width (tabular-nums) so digit-count changes in the
                completed count (7/13 → 10/13) never shift the bar. */}
            <span className="min-w-[5ch] text-center text-sm font-medium whitespace-nowrap tabular-nums">
              {summary.completedParts}/{summary.totalParts}
            </span>
          </div>
          {/* Right zone (flexible, min-w-0): avatars only, LEFT-aligned —
              with a single avatar, right-alignment left a dead gap between
              the count and the tile (verification feedback). */}
          <div className="flex min-w-0 items-center justify-start">
            {/* Fly-to-bar landing zone (ThumbnailFlightLayer targets this).
              Explicit children prop: AvatarGroup types children as a single
              ReactElement[] array, which the JSX multi-child form upsets. */}
            {/* Natural width (shrink-0): the zone's 1fr track absorbs
              avatar count changes, so the center never moves and the row
              never overflows at large font sizes. */}
            <div
              data-queue-avatar-target="true"
              className="flex h-8 shrink-0 justify-end"
            >
              <AvatarGroup className="h-8 shrink-0" children={avatars} />
            </div>
          </div>
        </div>
      </div>
    </AnimatedSection>
  )
}
