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
 * Generates pagination items with ellipsis for large page counts.
 *
 * @private
 */
function generatePaginationItems(
  totalPages: number,
  currentPage: number,
): (number | 'ellipsis')[] {
  const items: (number | 'ellipsis')[] = []
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  items.push(1)
  if (currentPage > 3) items.push('ellipsis')
  for (
    let i = Math.max(2, currentPage - 1);
    i <= Math.min(totalPages - 1, currentPage + 1);
    i++
  ) {
    items.push(i)
  }
  if (currentPage < totalPages - 2) items.push('ellipsis')
  items.push(totalPages)
  return items
}

/**
 * Bottom dock of the loaded page: pagination on the left, selection
 * summary + download CTA on the right.
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
      className="bg-card/90 flex h-16 flex-none items-center gap-3.5 border-t px-4 backdrop-blur sm:px-6"
    >
      {totalPages > 1 && (
        <Pagination className="w-auto">
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
      {hasSelection ? (
        <span className="ml-auto text-sm font-semibold whitespace-nowrap">
          {t('search.selected_count', { count: selectedCount })}
          <small className="text-muted-foreground ml-1.5 font-normal">
            {t('search.total_duration', {
              duration: formatDuration(totalSeconds),
            })}
          </small>
        </span>
      ) : (
        <span className="text-muted-foreground ml-auto text-xs font-normal whitespace-nowrap">
          {t('video.no_parts_selected')}
        </span>
      )}
      {hasSelection && <DownloadButton />}
    </div>
  )
}

export default DownloadDock
