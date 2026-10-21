import { QueuePartRow } from '@/pages/downloads/QueuePartRow'
import type { QueuePartRow as QueuePartRowModel } from '@/shared/queue'
import { Check, ChevronDown, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Section keys produced by DownloadsContent's section split. */
export type SectionKey =
  | 'section_downloading'
  | 'section_queued'
  | 'section_finished'

/**
 * Visual tone of one section card (2026-10-13 mockup approval; accent
 * rollout 2026-10-21 mockup approval: running tint follows the brand
 * token family, so settings ≫ accentColor recolors it).
 *
 * Tint only where the tone is unambiguous: downloading = brand (running),
 * queued = muted gray. The settled section mixes done/error/cancelled
 * parts, so it stays neutral — a single tint there would lie about the
 * rows it contains.
 */
const TONES: Record<
  SectionKey,
  { card: string; head: string; accent: string; dot: string; pulse: boolean }
> = {
  section_downloading: {
    card: 'border-brand-strong/30 bg-brand/5',
    head: 'bg-brand/10',
    accent: 'bg-brand-strong',
    dot: 'bg-brand-strong',
    pulse: true,
  },
  section_queued: {
    card: 'bg-muted/40',
    head: 'bg-muted/70',
    accent: 'bg-muted-foreground',
    dot: 'bg-muted-foreground',
    pulse: false,
  },
  section_finished: {
    card: 'bg-card',
    head: 'bg-card/85',
    accent: 'bg-muted-foreground',
    dot: 'bg-muted-foreground',
    pulse: false,
  },
}

type Props = {
  sectionKey: SectionKey
  rows: QueuePartRowModel[]
}

/** Per-status counts for the settled section's header breakdown pill. */
function breakdownOf(rows: QueuePartRowModel[]) {
  let done = 0
  let error = 0
  let cancelled = 0
  for (const row of rows) {
    if (row.status === 'done') done += 1
    else if (row.status === 'error') error += 1
    else cancelled += 1
  }
  return { done, error, cancelled }
}

/**
 * One rounded section container of the /downloads list: tinted card +
 * sticky collapsible header (accent bar, status dot, title, count pill,
 * settled-status breakdown) + the section's part rows.
 *
 * The header sticks to the top of the page's scroll container while the
 * card's rows scroll under it (backdrop-blur keeps the rows readable
 * through the translucent tint).
 */
export function QueueSection({ sectionKey, rows }: Props) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const tone = TONES[sectionKey]
  const breakdown = sectionKey === 'section_finished' ? breakdownOf(rows) : null

  // overflow-clip (not overflow-hidden): clips the sticky header's
  // rectangular background inside the rounded corners WITHOUT creating a
  // scroll container — overflow-hidden would break the header's
  // position: sticky against the page scroller.
  return (
    <section
      data-section={sectionKey}
      className={`overflow-clip rounded-xl border ${tone.card}`}
    >
      {/* Sticky wrapper (not the h2 itself): keeps the title text node
          assertion-clean for tests and keeps phrasing content valid. */}
      <div
        className={`border-border/60 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2 backdrop-blur-sm ${tone.head}`}
      >
        <span
          className={`h-3.5 w-[3px] shrink-0 rounded-full ${tone.accent}`}
          aria-hidden
        />
        <span
          className={`size-1.5 shrink-0 rounded-full ${tone.dot} ${
            tone.pulse ? 'animate-pulse' : ''
          }`}
          aria-hidden
        />
        <h2 className="text-sm font-semibold">{t(`queue.${sectionKey}`)}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Why: the pill flags error/cancelled parts; an all-done section
              has nothing to warn about, so it stays hidden (index.test.tsx
              pins this all-done case). */}
          {breakdown && (breakdown.error > 0 || breakdown.cancelled > 0) && (
            // Icons + counts (not color alone) so screen readers and
            // color-blind users get the same breakdown as the aria-label.
            <span
              className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums"
              aria-label={t('queue.breakdown', breakdown)}
            >
              {breakdown.done > 0 && (
                <span className="flex items-center gap-0.5 text-green-500">
                  <Check className="size-3" aria-hidden />
                  {breakdown.done}
                </span>
              )}
              {breakdown.error > 0 && (
                <span className="text-destructive flex items-center gap-0.5">
                  <TriangleAlert className="size-3" aria-hidden />
                  {breakdown.error}
                </span>
              )}
              {breakdown.cancelled > 0 && (
                <span className="flex items-center gap-0.5">
                  <X className="size-3" aria-hidden />
                  {breakdown.cancelled}
                </span>
              )}
            </span>
          )}
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs tabular-nums">
            {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={t(`queue.${sectionKey}`)}
            // Why: a plain <button> gets no focus styling from the Button
            // base, so this reproduces the app-wide 3px focus ring (see
            // src/components/ui/button.tsx) recolored to brand per the
            // 2026-10-21 accent rollout.
            className="text-muted-foreground hover:text-foreground focus-visible:ring-brand-strong/35 flex size-6 items-center justify-center rounded-md transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <ChevronDown
              className={`size-4 transition-transform ${
                collapsed ? '-rotate-90' : ''
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>
      {/* Native hidden attribute (not a Tailwind class): works without
          stylesheet processing and carries the semantics in jsdom tests. */}
      <div className="space-y-0.5 px-1.5 pt-1 pb-1.5" hidden={collapsed}>
        {/* Position is 1-based drain order — the queue runs one item at a
            time, so for pending rows this is the actual start order. */}
        {rows.map((row, index) => (
          <QueuePartRow
            key={row.item.downloadId}
            row={row}
            position={index + 1}
          />
        ))}
      </div>
    </section>
  )
}
