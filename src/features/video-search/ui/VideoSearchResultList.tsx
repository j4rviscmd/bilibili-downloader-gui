import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { cn } from '@/shared/lib/utils'
import { Skeleton } from '@/shared/ui/skeleton'
import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { formatDuration } from '../lib/formatDuration'

/** Placeholder card skeletons shown while a search/page fetch is in
 * flight — same footprint as real cards so the grid does not jump
 * (loading feedback guidance: preserve layout, no instant vanish). */
function ResultSkeletonGrid() {
  return (
    <ul
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="hover:bg-accent/50 flex gap-3 rounded-md p-2">
          <Skeleton className="h-[67px] w-[120px] shrink-0 rounded" />
          <div className="flex w-full flex-col gap-1.5 py-0.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Result card grid for the keyword video search.
 *
 * Cards hand off to the existing URL-search download flow via
 * `usePendingDownload` (favorites pattern: no cid — resolved downstream by
 * the URL search page). While loading, card-shaped skeletons keep the
 * layout stable instead of blanking the page.
 */
export function VideoSearchResultList() {
  const { t } = useTranslation()
  const { entries, numResults, loading, keyword } = useVideoSearch()
  const handleDownload = usePendingDownload()

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">{t('videoSearch.loading')}</span>
        <ResultSkeletonGrid />
      </div>
    )
  }

  if (entries.length === 0) {
    const searched = keyword !== ''
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
        <SearchX className="size-8 opacity-70" aria-hidden="true" />
        <p className="text-sm">
          {searched ? t('videoSearch.noResults') : t('videoSearch.placeholder')}
        </p>
        {searched && (
          <p className="text-xs">{t('videoSearch.noResultsHint')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {numResults > 0 && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {t('videoSearch.resultsCount', { count: numResults })}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.bvid}>
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
                <span className="absolute right-1 bottom-1 rounded-sm bg-black/75 px-1 text-[11px] font-medium text-white tabular-nums">
                  {formatDuration(entry.duration)}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 text-sm font-medium">
                  {entry.title}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {entry.author}
                </span>
                <span className="text-muted-foreground text-xs">
                  {entry.play.toLocaleString()}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
