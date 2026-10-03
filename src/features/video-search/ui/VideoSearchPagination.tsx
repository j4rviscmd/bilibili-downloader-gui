import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/ui/pagination'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'

/**
 * Generates pagination items with ellipsis for large page counts.
 *
 * Same windowing algorithm as the URL search page's part pagination
 * (src/pages/search/index.tsx) so both pages paginate identically.
 */
function generatePaginationItems(
  totalPages: number,
  currentPage: number,
): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const items: (number | 'ellipsis')[] = []
  for (let page = 1; page <= totalPages; page++) {
    const shouldShow =
      page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1
    if (!shouldShow) continue

    const prevItem = items[items.length - 1]
    if (typeof prevItem === 'number' && page - prevItem > 1) {
      items.push('ellipsis')
    }
    items.push(page)
  }
  return items
}

/**
 * Numbered pagination for the keyword video search (20 items per page and
 * the 50-page cap are fixed by the bilibili search API).
 *
 * Renders nothing before the first search and for single-page results.
 */
export function VideoSearchPagination() {
  const { t } = useTranslation()
  const { page, numPages, goToPage, loading } = useVideoSearch()

  if (numPages <= 1) return null

  return (
    <nav aria-label={t('videoSearch.title')}>
      <Pagination className="w-auto">
        <PaginationContent>
          <PaginationItem>
            {/* Why: PaginationPrevious/Next render an <a> (see
                src/shared/ui/pagination.tsx), which takes no `disabled`
                prop — pointer-events-none + opacity is the disabled idiom
                shared with getPaginationNavClassName in pages/search. */}
            <PaginationPrevious
              onClick={() => goToPage(Math.max(1, page - 1))}
              className={
                loading || page <= 1
                  ? 'pointer-events-none opacity-50'
                  : 'cursor-pointer'
              }
              aria-label={t('videoSearch.prevPage')}
            >
              {t('videoSearch.prevPage')}
            </PaginationPrevious>
          </PaginationItem>
          {generatePaginationItems(numPages, page).map((item, idx) =>
            item === 'ellipsis' ? (
              <PaginationItem key={`ellipsis-${idx}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  onClick={() => goToPage(item)}
                  isActive={page === item}
                  className="cursor-pointer"
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              onClick={() => goToPage(Math.min(numPages, page + 1))}
              className={
                loading || page >= numPages
                  ? 'pointer-events-none opacity-50'
                  : 'cursor-pointer'
              }
              aria-label={t('videoSearch.nextPage')}
            >
              {t('videoSearch.nextPage')}
            </PaginationNext>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </nav>
  )
}
