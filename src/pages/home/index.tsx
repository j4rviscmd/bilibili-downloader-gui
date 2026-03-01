import type { RootState } from '@/app/store'
import { store, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import type { Video } from '@/features/video'
import {
  deselectAll,
  deselectPageAll,
  DownloadButton,
  selectHasSelectedParts,
  selectPageAll,
  useVideoInfo,
  VideoForm1,
  VideoInfoProvider,
} from '@/features/video'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import VideoPartCardSkeleton from '@/features/video/ui/VideoPartCardSkeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { selectHasActiveDownloads } from '@/shared/queue'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/ui/pagination'
import { Separator } from '@/shared/ui/separator'
import { Skeleton } from '@/shared/ui/skeleton'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Info } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

/**
 * Props for the TooltipButton component.
 *
 * @property label - Button label text to display
 * @property onClick - Click event handler callback
 * @property disabled - Whether the button is disabled (optional)
 * @property tooltip - Tooltip text to show when disabled (optional)
 */
type TooltipButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}

/**
 * Button component that displays a tooltip when disabled.
 *
 * Shows a tooltip explaining why the button is disabled.
 *
 * @param props.label - Button label text
 * @param props.onClick - Click callback handler
 * @param props.disabled - Whether the button is disabled
 * @param props.tooltip - Tooltip text to display (optional)
 *
 * @private
 */
function TooltipButton({
  label,
  onClick,
  disabled,
  tooltip,
}: TooltipButtonProps) {
  const button = (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" arrow>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Number of parts per page in pagination. */
const PARTS_PER_PAGE = 10

/** Props for the PaginatedPartList component. */
type PaginatedPartListProps = {
  video: Video
  duplicateIndices: number[]
  isFetching: boolean
  currentPage: number
  onPageChange: (page: number) => void
  scrollToPartIndex: number | null
  scrollRequestId: number
  hasActiveDownloads: boolean
}

/**
 * Generates pagination items with ellipsis for large page counts.
 *
 * @param totalPages - Total number of pages
 * @param currentPage - Current active page
 * @returns Array of page numbers and 'ellipsis' markers
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

    // Add ellipsis if there's a gap
    const prevItem = items[items.length - 1]
    if (typeof prevItem === 'number' && page - prevItem > 1) {
      items.push('ellipsis')
    }
    items.push(page)
  }
  return items
}

/**
 * Computes the className for pagination navigation buttons.
 *
 * @param isDisabled - Whether this button is at its boundary (first/last page)
 * @param hasActiveDownloads - Whether downloads are in progress
 * @returns CSS class string
 */
function getPaginationNavClassName(
  isDisabled: boolean,
  hasActiveDownloads: boolean,
): string {
  if (isDisabled) {
    return 'pointer-events-none opacity-50'
  }
  return hasActiveDownloads ? 'cursor-not-allowed' : 'cursor-pointer'
}

/**
 * Paginated part list with pagination controls.
 *
 * Displays parts in pages of 10. Quality info is fetched lazily
 * when the user opens the options accordion for each part.
 *
 * @param props.video - Video information
 * @param props.duplicateIndices - Indices of parts with duplicate titles
 * @param props.isFetching - Whether video info is being fetched
 * @param props.currentPage - Current page number (1-indexed)
 * @param props.onPageChange - Callback when page changes
 *
 * @private
 */
function PaginatedPartList({
  video,
  duplicateIndices,
  isFetching,
  currentPage,
  onPageChange,
  scrollToPartIndex,
  scrollRequestId,
  hasActiveDownloads,
}: PaginatedPartListProps) {
  const { t } = useTranslation()
  const totalPages = Math.ceil(video.parts.length / PARTS_PER_PAGE)

  // Calculate the range of parts for the current page
  const pageRange = useMemo(() => {
    const startIndex = (currentPage - 1) * PARTS_PER_PAGE
    const endIndex = Math.min(
      startIndex + PARTS_PER_PAGE - 1,
      video.parts.length - 1,
    )
    return { startIndex, endIndex }
  }, [currentPage, video.parts.length])

  // Create a unique key for scroll tracking
  // Include scrollRequestId to ensure each navigation triggers a new scroll
  const scrollKey = useMemo(() => {
    return `${video.bvid}-${scrollToPartIndex}-${scrollRequestId}`
  }, [video.bvid, scrollToPartIndex, scrollRequestId])

  // Track which scrollKey has been scrolled
  const scrolledKeysRef = useRef<Set<string>>(new Set())

  // Scroll to specific part on initial load (when p=n is specified)
  useEffect(() => {
    if (
      scrollToPartIndex !== null &&
      scrollKey &&
      scrollToPartIndex >= pageRange.startIndex &&
      scrollToPartIndex <= pageRange.endIndex &&
      !scrolledKeysRef.current.has(scrollKey) &&
      !isFetching
    ) {
      scrolledKeysRef.current.add(scrollKey)
      // Use setTimeout to wait for React re-render to complete
      // The DOM elements may not have correct positions immediately after state changes
      setTimeout(() => {
        const cardContent = document.querySelector('[data-part-list]')
        const targetPart = document.querySelector(
          `[data-part-index="${scrollToPartIndex}"]`,
        )
        if (cardContent && targetPart) {
          const containerRect = cardContent.getBoundingClientRect()
          const targetRect = targetPart.getBoundingClientRect()
          const scrollOffset =
            targetRect.top - containerRect.top + cardContent.scrollTop - 20
          cardContent.scrollTo({
            top: scrollOffset,
            behavior: 'smooth',
          })
        }
      }, 100)
    }
  }, [
    scrollToPartIndex,
    scrollKey,
    pageRange.startIndex,
    pageRange.endIndex,
    isFetching,
  ])

  // Clean up old scroll keys when video changes (keep only recent ones)
  useEffect(() => {
    if (scrolledKeysRef.current.size > 10) {
      scrolledKeysRef.current = new Set()
    }
  }, [video.bvid])

  // Render parts for current page
  const pageParts = useMemo(() => {
    const parts: React.ReactNode[] = []
    for (let i = pageRange.startIndex; i <= pageRange.endIndex; i++) {
      const part = video.parts[i]
      if (!part) continue
      parts.push(
        <div key={part.cid} data-part-index={i}>
          <VideoPartCard
            video={video}
            page={i + 1}
            isDuplicate={duplicateIndices.includes(i)}
          />
          {i < pageRange.endIndex && <Separator className="my-3" />}
        </div>,
      )
    }
    return parts
  }, [video, duplicateIndices, pageRange.startIndex, pageRange.endIndex])

  if (isFetching) {
    return (
      <CardContent className="space-y-0">
        <VideoPartCardSkeleton />
      </CardContent>
    )
  }

  return (
    <>
      <CardContent
        data-part-list
        className="max-h-[calc(100dvh-2.3rem-19.5rem)] space-y-0 overflow-y-auto"
      >
        {pageParts}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        {totalPages > 1 && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Pagination
                  className={cn(
                    hasActiveDownloads ? 'opacity-50' : '',
                    'w-auto',
                  )}
                >
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => {
                          if (hasActiveDownloads) return
                          onPageChange(Math.max(1, currentPage - 1))
                        }}
                        className={getPaginationNavClassName(
                          currentPage === 1,
                          hasActiveDownloads,
                        )}
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
                              onClick={() => {
                                if (hasActiveDownloads) return
                                onPageChange(item)
                              }}
                              isActive={currentPage === item}
                              className={
                                hasActiveDownloads
                                  ? 'cursor-not-allowed'
                                  : 'cursor-pointer'
                              }
                            >
                              {item}
                            </PaginationLink>
                          </PaginationItem>
                        ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => {
                          if (hasActiveDownloads) return
                          onPageChange(Math.min(totalPages, currentPage + 1))
                        }}
                        className={getPaginationNavClassName(
                          currentPage === totalPages,
                          hasActiveDownloads,
                        )}
                      >
                        {t('video.pagination_next')}
                      </PaginationNext>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </TooltipTrigger>
              {hasActiveDownloads && (
                <TooltipContent side="top" arrow>
                  {t('video.navigation_disabled_tooltip')}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
        <div className="w-full">
          <DownloadButton />
        </div>
      </CardFooter>
    </>
  )
}

/**
 * Internal home page content component.
 *
 * Uses VideoInfoContext to display video URL input form and part configuration cards.
 * This component must be rendered within a `VideoInfoProvider`.
 *
 * Features:
 * - Login benefits info (shown when not logged in)
 * - Video URL input (Step 1)
 * - Part selection and configuration (Step 2)
 * - Select all / Deselect all buttons (current page only)
 * - Download button
 * - Auto-fetch via autoFetch query parameter
 * - Pagination synced with ?p=N URL parameter
 *
 * @private
 */
function HomeContentInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { video, duplicateIndices, onValid1, isFetching, input } =
    useVideoInfo()
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const user = useSelector((state: RootState) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  // Page state management:
  // - `p` parameter: part number (for initial display and part selection)
  // - `page` parameter: page number (for pagination navigation)
  // Priority: page param > p param (calculate from part) > default page 1
  const totalPages = Math.ceil(video.parts.length / PARTS_PER_PAGE)

  // Check for explicit page parameter first
  const browserPage = searchParams.get('page')
  // Check for p parameter (part number)
  const browserP = searchParams.get('p')

  // Use useState for scrollToPartIndex to ensure re-renders propagate to child components
  const [scrollToPartIndex, setScrollToPartIndex] = useState<number | null>(
    null,
  )

  /**
   * Current page number derived from URL search parameters and Redux state.
   *
   * Resolution priority (highest to lowest):
   * 1. `?page=N` — explicit pagination parameter
   * 2. `?p=N` — part number parameter (converted to page)
   * 3. `pendingDownload.page` — pending download from history
   * 4. `?p=N` embedded in the stored input URL
   * 5. Default: page 1
   *
   * Result is clamped to `[1, totalPages]`.
   */
  const currentPage = useMemo(() => {
    let page = 1

    if (browserPage) {
      page = parseInt(browserPage, 10)
    } else if (browserP) {
      page = Math.ceil(parseInt(browserP, 10) / PARTS_PER_PAGE)
    } else if (input.pendingDownload) {
      page = Math.ceil(input.pendingDownload.page / PARTS_PER_PAGE)
    } else if (input.url) {
      try {
        const pParam = new URL(input.url).searchParams.get('p')
        if (pParam) {
          page = Math.ceil(parseInt(pParam, 10) / PARTS_PER_PAGE)
        }
      } catch {
        // Invalid URL, use default
      }
    }

    return Math.max(1, Math.min(page, totalPages || 1))
  }, [browserPage, browserP, input.pendingDownload, input.url, totalPages])

  // Track scroll request timestamp to ensure each navigation triggers scroll
  const [scrollRequestId, setScrollRequestId] = useState(0)

  // Confirmation dialog state for page navigation
  const [pendingPageChange, setPendingPageChange] = useState<number | null>(
    null,
  )
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)

  // Check if any part is selected
  const hasSelectedParts = useSelector(selectHasSelectedParts)

  // Track previous pendingDownload to detect when it's cleared
  const prevPendingDownloadRef = useRef<typeof input.pendingDownload>(null)

  useEffect(() => {
    if (video.parts.length === 0 || isFetching) return

    let targetIndex: number | null = null

    if (browserP) {
      targetIndex = parseInt(browserP, 10) - 1
    } else if (input.url) {
      try {
        const pParam = new URL(input.url).searchParams.get('p')
        if (pParam) {
          targetIndex = parseInt(pParam, 10) - 1
        }
      } catch {
        // Invalid URL
      }
    }

    setScrollToPartIndex(targetIndex)
    if (targetIndex !== null) {
      setScrollRequestId((prev) => prev + 1)
    }
  }, [browserP, input.url, video.parts.length, isFetching])

  // Trigger scroll after pendingDownload is cleared (video info fetch complete)
  useEffect(() => {
    const prevPending = prevPendingDownloadRef.current
    prevPendingDownloadRef.current = input.pendingDownload

    if (video.parts.length === 0 || isFetching) return

    if (prevPending && !input.pendingDownload) {
      const targetIndex = prevPending.page - 1
      setScrollToPartIndex(targetIndex)
      setScrollRequestId((prev) => prev + 1)
    }
  }, [input.pendingDownload, video.parts.length, isFetching])

  /**
   * Performs the actual page change without confirmation.
   *
   * @param page - The target page number (1-indexed)
   */
  const performPageChange = useCallback(
    (page: number) => {
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('p')
      newParams.set('page', String(page))
      setSearchParams(newParams, { replace: true })
      const cardContent = document.querySelector('[data-part-list]')
      if (cardContent) {
        cardContent.scrollTop = 0
      }
    },
    [searchParams, setSearchParams],
  )

  /**
   * Handles pagination navigation with confirmation dialog when parts are selected.
   *
   * If parts are selected, shows a confirmation dialog before navigating.
   * On confirmation, clears selection and navigates to the new page.
   * On cancel, stays on the current page.
   *
   * @param page - The target page number (1-indexed)
   */
  const handlePageChange = useCallback(
    (page: number) => {
      // Skip confirmation if navigating to the same page
      if (page === currentPage) return

      if (hasSelectedParts) {
        setPendingPageChange(page)
        setIsConfirmDialogOpen(true)
      } else {
        performPageChange(page)
      }
    },
    [currentPage, hasSelectedParts, performPageChange],
  )

  /**
   * Confirms page navigation: clears selection and navigates.
   */
  const handleConfirmNavigation = useCallback(() => {
    if (pendingPageChange !== null) {
      store.dispatch(deselectAll())
      performPageChange(pendingPageChange)
    }
    setIsConfirmDialogOpen(false)
    setPendingPageChange(null)
  }, [pendingPageChange, performPageChange])

  /**
   * Cancels page navigation: closes dialog without changes.
   */
  const handleCancelNavigation = useCallback(() => {
    setIsConfirmDialogOpen(false)
    setPendingPageChange(null)
  }, [])

  /**
   * Part index range (0-based, inclusive) for the currently visible page.
   * Used to scope select/deselect operations to the current page only.
   */
  // Calculate page range for select/deselect operations
  const pageRange = useMemo(() => {
    const startIndex = (currentPage - 1) * PARTS_PER_PAGE
    const endIndex = Math.min(
      startIndex + PARTS_PER_PAGE - 1,
      video.parts.length - 1,
    )
    return { startIndex, endIndex }
  }, [currentPage, video.parts.length])

  // Handle autoFetch from query parameter
  useEffect(() => {
    const autoFetchUrl = searchParams.get('autoFetch')
    if (autoFetchUrl && !isFetching && video.parts.length === 0) {
      searchParams.delete('autoFetch')
      setSearchParams(searchParams, { replace: true })
      onValid1(autoFetchUrl)
    }
  }, [searchParams, isFetching, video.parts.length, onValid1, setSearchParams])

  // Sync page when video parts change
  useEffect(() => {
    if (video.parts.length > 0 && currentPage > totalPages) {
      handlePageChange(totalPages)
    }
  }, [video.parts.length, currentPage, totalPages, handlePageChange])

  const selectTooltip = hasActiveDownloads
    ? t('video.download_in_progress')
    : undefined

  // Select all parts on current page
  const handleSelectAllCurrentPage = useCallback(() => {
    store.dispatch(selectPageAll(pageRange))
  }, [pageRange])

  // Deselect all parts on current page
  const handleDeselectAllCurrentPage = useCallback(() => {
    store.dispatch(deselectPageAll(pageRange))
  }, [pageRange])

  return (
    <div className="flex h-full flex-col">
      {/* Step 1: Fixed Area (outside scroll) */}
      <div className="mx-auto w-full max-w-5xl px-3 pt-3 pb-3 sm:px-6">
        {/* Login Benefits Info - shown only when not logged in */}
        {!isLoggedIn && (
          <Alert variant="info" className="mb-3">
            <Info />
            <AlertTitle>{t('video.login_benefits_title')}</AlertTitle>
            <AlertDescription className="flex flex-wrap">
              <Trans
                i18nKey="video.login_benefits_description"
                components={{
                  1: (
                    <button
                      type="button"
                      onClick={() => openUrl('https://www.bilibili.com')}
                      className="inline cursor-pointer text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    />
                  ),
                }}
              />
              <span className="mt-1 w-full text-xs opacity-80">
                {t('video.login_benefits_restart_note')}
              </span>
            </AlertDescription>
          </Alert>
        )}

        {/* Step 1: URL Input Card */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">
              {t('video.step1_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VideoForm1 />
          </CardContent>
        </Card>
      </div>

      {/* Step 2: Paginated Area */}
      {(isFetching || video.parts.length > 0) && (
        <div className="mx-auto w-full max-w-5xl px-3 pb-3 sm:px-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-lg">
                  {t('video.step2_title')}
                </CardTitle>
                {isFetching ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-[88px]" />
                    <Skeleton className="h-8 w-[68px]" />
                    <Skeleton className="h-8 w-[68px]" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <DownloadButton />
                    <TooltipButton
                      label={t('video.select_all_page')}
                      onClick={handleSelectAllCurrentPage}
                      disabled={hasActiveDownloads}
                      tooltip={selectTooltip}
                    />
                    <TooltipButton
                      label={t('video.deselect_all_page')}
                      onClick={handleDeselectAllCurrentPage}
                      disabled={hasActiveDownloads}
                      tooltip={selectTooltip}
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <PaginatedPartList
              video={video}
              duplicateIndices={duplicateIndices}
              isFetching={isFetching}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              scrollToPartIndex={scrollToPartIndex}
              scrollRequestId={scrollRequestId}
              hasActiveDownloads={hasActiveDownloads}
            />
          </Card>
        </div>
      )}

      {/* Confirmation Dialog for Page Navigation */}
      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent disableOutsideClick>
          <DialogHeader>
            <DialogTitle>{t('video.confirm_navigation_title')}</DialogTitle>
            <DialogDescription>
              {t('video.confirm_navigation_message')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelNavigation}>
              {t('video.confirm_navigation_cancel')}
            </Button>
            <Button onClick={handleConfirmNavigation}>
              {t('video.confirm_navigation_ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Home page content component (main application view).
 *
 * This is the content portion of the home page without the layout wrapper.
 * It should be rendered inside a PageLayoutShell or similar layout.
 *
 * Displays the primary UI for video downloads including:
 * - Video URL input form (Step 1)
 * - Video parts configuration forms (Step 2)
 * - Select all/deselect all buttons (current page only)
 * - Download button
 * - Download progress (inline in each part card)
 * - Pagination synced with ?p=N URL parameter
 *
 * Redirects to /init if the app is not initialized.
 * Supports autoFetch query parameter to automatically fetch video info.
 *
 * @example
 * ```tsx
 * // Inside PersistentPageLayout
 * <HomeContent />
 * ```
 */
export function HomeContent() {
  const { initiated } = useInit()
  const navigate = useNavigate()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <VideoInfoProvider>
      <HomeContentInner />
    </VideoInfoProvider>
  )
}

export default HomeContent
