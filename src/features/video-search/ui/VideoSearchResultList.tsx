import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { formatDuration } from '../lib/formatDuration'

/**
 * Result card grid for the keyword video search.
 *
 * Cards hand off to the existing URL-search download flow via
 * `usePendingDownload` (favorites pattern: no cid — resolved downstream by
 * the URL search page).
 */
export function VideoSearchResultList() {
  const { t } = useTranslation()
  const { entries, numResults } = useVideoSearch()
  const handleDownload = usePendingDownload()

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        {t('videoSearch.noResults')}
      </p>
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
              className="hover:bg-accent flex w-full gap-3 rounded-md p-2 text-left transition-colors"
              aria-label={entry.title}
            >
              <img
                src={entry.cover}
                alt=""
                loading="lazy"
                className="h-16 w-28 shrink-0 rounded object-cover"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="line-clamp-2 text-sm font-medium">
                  {entry.title}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {entry.author}
                </span>
                <span className="text-muted-foreground text-xs">
                  {entry.play.toLocaleString()} ·{' '}
                  {formatDuration(entry.duration)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
