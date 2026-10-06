import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { VideoCardGrid, VideoCardSkeletonGrid } from './VideoCardGrid'

/**
 * Result card grid for the keyword video search.
 *
 * Renders card-shaped skeletons while a fetch is in flight and a
 * no-results/placeholder empty state; the cards themselves live in the
 * shared [`VideoCardGrid`] (also used by the popular feed).
 */
export function VideoSearchResultList() {
  const { t } = useTranslation()
  const { entries, loading, keyword } = useVideoSearch()

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only">{t('videoSearch.loading')}</span>
        <VideoCardSkeletonGrid />
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

  return <VideoCardGrid entries={entries} />
}
