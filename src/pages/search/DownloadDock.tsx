import { formatDuration } from '@/features/video-search/lib/formatDuration'
import DownloadButton from '@/features/video/ui/DownloadButton'
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

/**
 * Generates pagination items, capped at 5 visible slots (numbers and
 * ellipsis markers) so the dock's center column stays narrow.
 *
 * @private
 */
function generatePaginationItems(
  totalPages: number,
  currentPage: number,
): (number | 'ellipsis')[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 'ellipsis', totalPages]
  }
  if (currentPage >= totalPages - 2) {
    return [1, 'ellipsis', totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, 'ellipsis', currentPage, 'ellipsis', totalPages]
}

/**
 * Bottom dock of the loaded page, as a 3-column grid: selection summary
 * (left, truncates) / pagination (center) / download CTA (right). Side
 * columns are minmax(0,1fr) so the pager stays dead-center while the
 * summary shrinks with an ellipsis — the 980px minimum window with the
 * sidebar expanded leaves the dock only ~676px of content width, so the
 * pager is capped at 5 slots (see generatePaginationItems).
 *
 * Rendered as a flex sibling BELOW the page scroller (never inside it), so
 * both stay reachable without scrolling. The height is fixed: the hint
 * (nothing selected) and the CTA row (1+ selected) must occupy the same
 * box, otherwise the scroller would resize on every selection change.
 *
 * The CTA is the existing `DownloadButton` — its disabled/tooltip logic
 * stays single-sourced. The hint replaces only the summary text, using the
 * existing `video.no_parts_selected` copy.
 *
 * @example
 * ```tsx
 * <DownloadDock
 *   totalPages={totalPages}
 *   currentPage={currentPage}
 *   onPageChange={handlePageChange}
 *   selectedCount={selectedCount}
 *   totalSeconds={totalSeconds}
 * />
 * ```
 */
export function DownloadDock({
  totalPages,
  currentPage,
  onPageChange,
  selectedCount,
  totalSeconds,
}: {
  totalPages: number
  currentPage: number
  onPageChange: (page: number) => void
  selectedCount: number
  totalSeconds: number
}) {
  const { t } = useTranslation()
  const hasSelection = selectedCount > 0

  return (
    <div
      data-download-dock
      className="bg-card/90 grid h-16 flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3.5 border-t px-4 backdrop-blur sm:px-6"
    >
      {hasSelection ? (
        <span className="col-start-1 min-w-0 truncate text-sm font-semibold">
          {t('search.selected_count', { count: selectedCount })}
          <small className="text-muted-foreground ml-1.5 font-normal">
            {t('search.total_duration', {
              duration: formatDuration(totalSeconds),
            })}
          </small>
        </span>
      ) : (
        <span className="text-muted-foreground col-start-1 min-w-0 truncate text-xs font-normal">
          {t('video.no_parts_selected')}
        </span>
      )}
      {totalPages > 1 && (
        <Pagination className="col-start-2 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                className={
                  currentPage === 1
                    ? 'pointer-events-none opacity-50'
                    : 'cursor-pointer'
                }
              >
                {t('video.pagination_previous')}
              </PaginationPrevious>
            </PaginationItem>
            {generatePaginationItems(totalPages, currentPage).map(
              (item, idx) =>
                item === 'ellipsis' ? (
                  <PaginationItem key={`ellipsis-${idx}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      onClick={() => onPageChange(item)}
                      isActive={currentPage === item}
                      className="cursor-pointer"
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                ),
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() =>
                  onPageChange(Math.min(totalPages, currentPage + 1))
                }
                className={
                  currentPage === totalPages
                    ? 'pointer-events-none opacity-50'
                    : 'cursor-pointer'
                }
              >
                {t('video.pagination_next')}
              </PaginationNext>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
      {/* Why: explicit col-start slots instead of grid auto-placement —
          with the pager unmounted (single-page result) auto-flow would
          slide the CTA into the empty center column (see the single-page
          dock spec in src/pages/search/index.test.tsx) */}
      {hasSelection && (
        <div className="col-start-3 flex justify-end">
          <DownloadButton />
        </div>
      )}
    </div>
  )
}

export default DownloadDock
