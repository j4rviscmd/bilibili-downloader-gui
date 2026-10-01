import { Button } from '@/shared/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'

/**
 * Prev/next pagination (20 items per page, fixed by the bilibili API).
 * Renders nothing before the first search.
 */
export function VideoSearchPagination() {
  const { t } = useTranslation()
  const { page, numPages, goToPage, loading } = useVideoSearch()

  if (numPages <= 0) return null

  return (
    <nav
      className="flex items-center justify-center gap-3 pt-2"
      aria-label={t('videoSearch.title')}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1 || loading}
        onClick={() => goToPage(page - 1)}
        aria-label={t('videoSearch.prevPage')}
      >
        <ChevronLeft />
        {t('videoSearch.prevPage')}
      </Button>
      <span className="text-muted-foreground text-sm tabular-nums">
        {page} / {numPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= numPages || loading}
        onClick={() => goToPage(page + 1)}
        aria-label={t('videoSearch.nextPage')}
      >
        {t('videoSearch.nextPage')}
        <ChevronRight />
      </Button>
    </nav>
  )
}
