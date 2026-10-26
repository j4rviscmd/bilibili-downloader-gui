import { useSelector } from '@/app/store'
import {
  AvatarGroup,
  AvatarGroupTooltip,
} from '@/components/animate-ui/components/animate/avatar-group'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AnimatedSection } from '@/shared/animate-ui/effects/animated-section'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Button } from '@/shared/ui/button'
import { Download, Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { selectQueueSummary } from '../selectors'
import { ConcurrencyLink } from './ConcurrencyLink'

/**
 * Formats a KB/s value with adaptive units for the bottom bar's rate and
 * speed-limit displays: below 1000 stays KB/s, above scales to MB/s
 * (decimal, matching the "1000 kb/s = 1 mb/s" hint). Display only — the
 * stored setting stays KB/s. Up to one fraction digit (e.g. 1500 → "1.5").
 * Literal "KB/s"/"MB/s" follows the app's existing speed display
 * convention (PartDownloadProgress), not per-locale unit names.
 */
export function formatKbps(kbps: number): string {
  if (kbps < 1000) {
    return `${kbps.toLocaleString()} KB/s`
  }
  const mbps = (kbps / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
  return `${mbps} MB/s`
}

/**
 * Bottom download bar (issue #691, Steam-like), mounted once in
 * PageLayoutShell so it survives page navigation.
 *
 * Visible while the queue holds ANY item (`hasAnyItems`): overall
 * progress across every session, completed mp4 count (`12/38`), summed
 * transfer rate (doubling as the speed-limit settings entry while
 * downloads are active), and an avatar-group of the active
 * PARTS' thumbnails (FIFO head, up to 5, then `+N` — one avatar per part,
 * so enqueuing several parts adds several avatars). The whole area
 * navigates to `/downloads` — cancellation lives there, deliberately not
 * here.
 *
 * Motion: the first enqueue animates the bar in via AnimatedSection's
 * height spring, and each new session thumbnail pops in (zoom-in). The
 * fly-to-bar thumbnail flight was removed with the URL-page redesign:
 * the download dock keeps the enqueue destination permanently on
 * screen, so the eye-guidance motion no longer conveyed anything the
 * static UI didn't.
 */
export function QueueBottomBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const summary = useSelector(selectQueueSummary)
  const settings = useSelector((state) => state.settings)
  const limitEnabled = settings.downloadSpeedLimitEnabled ?? false

  const percent = Math.min(100, Math.round(summary.overallRatio * 100))

  const openDownloads = () => navigate('/downloads')
  // Same deep link the former standalone SpeedLimitLink used (issue #421).
  const openSpeedLimitSettings = () =>
    navigate('/settings?category=download&anchor=speed-limit')

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
        {/* Why: The grid cap must mirror PageTemplate.tsx's frame token:
            this bar is layout chrome mounted below page content on every
            page (see PageLayout.tsx, issue #691), so a different cap would
            offset the bar's content from the page edges above. */}
        <div className="mx-auto grid w-full max-w-[104rem] grid-cols-[1fr_3fr_1fr] items-center gap-3">
          {/* Left zone (flexible, min-w-0): rate + speed-limit live LEFT of
              the bar so the right zone stays avatars-only — the two 1fr
              tracks keep the center cluster centered no matter how the
              rate/limit content changes. NOT fixed-width: at the max app
              font size fixed side zones plus a wide center overflowed and
              clipped the avatars, so the zones flex and shrink instead. */}
          {/* justify-end: the cluster hugs the bar — the rate sits
              immediately left of the bar — so the layout reads the same
              whether the limit is on or off (verification feedback). */}
          {/* @container: the zone's OWN width drives the degrade ladder
              below (sidebar open + narrow window shrinks this 1fr track),
              so responsiveness follows actual available space, not the
              window width. Only the concurrency badge drops (<130px) —
              the rate stack never needs a tier: the sub-label stacks
              UNDER the rate (never wider than its min-w-[9ch] line), so
              it costs no horizontal space at any width. Settings remains
              the entry point for what dropped (same philosophy as the
              idle state). */}
          <div className="@container flex min-w-0 items-center justify-end gap-3">
            {/* Rate display doubling as the speed-limit entry (merged with
                the former standalone SpeedLimitLink, issue #421): while
                downloads are active the rate is a button deep-linking
                into the speed-limit setting, with the active cap as a
                faint sub-label beneath it. The two-line stack (18px +
                14px) matches the avatars' h-8 so the bar height never
                changes across limit on/off, and the blank idle
                placeholder keeps the zone width identical in every
                state. */}
            {summary.hasActive ? (
              <span
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="contents"
              >
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* min-w-[9ch] mirrors the idle placeholder so the
                          bar-adjacent edge never shifts; -mx cancels the
                          hover padding so the visual width stays
                          content-only. Internal affordance: the wrapper
                          above stops the bar's whole-area /downloads
                          navigation. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openSpeedLimitSettings}
                        aria-label={
                          limitEnabled
                            ? t('downloadStatus.speed_limit_tooltip')
                            : t('downloadStatus.speed_limit_set')
                        }
                        data-testid="speed-limit-link"
                        className="text-muted-foreground hover:text-foreground -mx-1.5 h-8 min-w-[9ch] flex-col items-end justify-center gap-0 px-1.5 font-normal tabular-nums"
                      >
                        <span className="text-sm leading-[18px] whitespace-nowrap">
                          {/* Dash placeholder while active but nothing is
                              transferring (preparing / stalled / merging):
                              a blank line read as a broken control once
                              the rate became a button (verification
                              decision). Unit fixed to MB/s — there is no
                              measurement to scale units from. */}
                          {summary.aggregateTransferRate > 0
                            ? formatKbps(summary.aggregateTransferRate)
                            : '- MB/s'}
                        </span>
                        {/* Tiny gauge + value distinguishes the cap from
                            the live rate directly above it. No container
                            tier: stacked under the rate it adds no
                            horizontal width (its text is narrower than
                            the rate's min-w-[9ch] line), so hiding it at
                            narrow zone widths (the former <300px tier)
                            saved no space — it only made the cap value
                            invisible at every normal window width (the
                            1fr/3fr/1fr left zone stays below 300px
                            until the window is ~1580px wide). */}
                        {/* Why: "enabled" and the kbps value are
                            independently optional in settings.json (serde
                            defaults, models/settings.rs) — a legacy
                            settings file can enable a cap with no stored
                            value; skip it rather than format undefined. */}
                        {limitEnabled &&
                          settings.downloadSpeedLimitKbps != null && (
                            <span className="text-muted-foreground/60 flex items-center gap-0.5 text-[11px] leading-[14px] whitespace-nowrap">
                              <Gauge className="size-2.5" aria-hidden />
                              {formatKbps(settings.downloadSpeedLimitKbps)}
                            </span>
                          )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {/* max-w-xs wraps the sentence (same pattern as the
                          parallelism CDN warning tooltip). */}
                      {limitEnabled ? (
                        <p className="max-w-xs">
                          {t('downloadStatus.speed_limit_tooltip')}
                        </p>
                      ) : (
                        t('downloadStatus.speed_limit_set')
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="@max-[129px]:hidden @min-[130px]:contents">
                  <ConcurrencyLink />
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground min-w-[9ch] text-right text-sm whitespace-nowrap tabular-nums" />
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
            {/* Natural width (shrink-0): the zone's 1fr track absorbs
              avatar count changes, so the center never moves and the row
              never overflows at large font sizes. */}
            {/* Explicit children prop: AvatarGroup types children as a
                single ReactElement[] array, which the JSX multi-child form
                upsets. */}
            <div className="flex h-8 shrink-0 justify-end">
              <AvatarGroup className="h-8 shrink-0" children={avatars} />
            </div>
          </div>
        </div>
      </div>
    </AnimatedSection>
  )
}
