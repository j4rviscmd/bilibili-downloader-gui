import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { SEARCH_ZONES } from '../lib/zones'
import type { VideoSearchOrder } from '../types'
import { VIDEO_SEARCH_ORDERS } from '../types'

/** Duration-bucket i18n keys, indexed by the raw `duration` param value. */
const DURATION_KEYS = [
  'all',
  'under10',
  'min10to30',
  'min30to60',
  'over60',
] as const

/** One select of the filter bar: visible label + Radix Select. */
function FilterSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className="min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

/**
 * Filter bar for the keyword video search: sort order, duration bucket and
 * zone (分区), mirroring the bilibili search page.
 *
 * Changing any select re-runs the last keyword at page 1 immediately
 * (bilibili behavior). Before the first search there is no keyword to
 * filter, so the selects render disabled with a tooltip explaining why.
 */
export function VideoSearchFilterBar() {
  const { t } = useTranslation()
  const { keyword, numResults, filters, setFilter } = useVideoSearch()
  // No keyword yet → nothing to filter; the tooltip says why. Stays
  // enabled while loading: the hook's stale-response guard already makes
  // rapid filter flips safe.
  const disabled = keyword === ''

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
            A span wrapper is required: a disabled Radix Select trigger
            gets pointer-events: none and hover never reaches it (same
            idiom as the downloads toolbar's disabled buttons).
          */}
          <span
            className="flex flex-wrap items-end gap-3"
            aria-label={t('videoSearch.filters.groupLabel')}
          >
            <FilterSelect
              id="video-search-filter-order"
              label={t('videoSearch.filters.orderLabel')}
              value={filters.order}
              disabled={disabled}
              onChange={(v) => setFilter({ order: v as VideoSearchOrder })}
              options={VIDEO_SEARCH_ORDERS.map((value) => ({
                value,
                label: t(`videoSearch.filters.order.${value}`),
              }))}
            />
            <FilterSelect
              id="video-search-filter-duration"
              label={t('videoSearch.filters.durationLabel')}
              value={String(filters.duration)}
              disabled={disabled}
              onChange={(v) => setFilter({ duration: Number(v) })}
              options={DURATION_KEYS.map((key, value) => ({
                value: String(value),
                label: t(`videoSearch.filters.duration.${key}`),
              }))}
            />
            <FilterSelect
              id="video-search-filter-zone"
              label={t('videoSearch.filters.zoneLabel')}
              value={String(filters.tids)}
              disabled={disabled}
              onChange={(v) => setFilter({ tids: Number(v) })}
              options={[
                { value: '0', label: t('videoSearch.zones.all') },
                ...SEARCH_ZONES.map((z) => ({
                  value: String(z.tid),
                  label: t(`videoSearch.zones.${z.key}`),
                })),
              ]}
            />
            {/* Result count rides the filter row (height saving): right
                aligned with the select triggers, announced politely. */}
            {numResults > 0 && (
              <p
                className="text-muted-foreground ml-auto self-end pb-1.5 text-sm"
                aria-live="polite"
              >
                {t('videoSearch.resultsCount', { count: numResults })}
              </p>
            )}
          </span>
        </TooltipTrigger>
        {disabled && (
          <TooltipContent>
            {t('videoSearch.filters.disabledHint')}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}
