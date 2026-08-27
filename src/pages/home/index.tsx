import type { RootState } from '@/app/store'
import { store, useAppDispatch, useSelector } from '@/app/store'
import { OpenDownloadStatusDialogButton } from '@/features/download-status'
import { getHistory } from '@/features/history/api/historyApi'
import { setEntries as setHistoryEntries } from '@/features/history/model/historySlice'
import { useInit } from '@/features/init'
import { QRCodeLoginDialog } from '@/features/login'
import type { Video } from '@/features/video'
import {
  deselectAll,
  DownloadButton,
  PARTS_PER_PAGE,
  selectAll,
  setHomePage,
  useVideoInfo,
  VideoForm1,
  VideoInfoProvider,
} from '@/features/video'
import { collectDownloadedPartIndices } from '@/features/video/lib/downloadedParts'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import VideoPartCardSkeleton from '@/features/video/ui/VideoPartCardSkeleton'
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
 * @property tooltip - Tooltip text (shown on hover; required for disabled buttons)
 */
type TooltipButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}

/**
 * Button that shows a tooltip on hover.
 *
 * Disabled buttons use a wrapping span so the tooltip still fires when
 * `pointer-events: none` blocks the native hover target.
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

/** Computes the className for pagination navigation buttons. */
function getPaginationNavClassName(
  isDisabled: boolean,
  hasActiveDownloads: boolean,
): string {
  if (isDisabled) return 'pointer-events-none opacity-50'
  return hasActiveDownloads ? 'cursor-not-allowed' : 'cursor-pointer'
}

/**
 * Paginated part list with pagination controls.
 *
 * Displays parts in pages of 10. Quality info is fetched lazily
 * when the user opens the options accordion for each part.
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
 * @private
 */
function HomeContentInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { video, duplicateIndices, onValid1, isFetching, input } =
    useVideoInfo()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const queue = useSelector((state: RootState) => state.queue)
  const historyEntries = useSelector(
    (state: RootState) => state.history.entries,
  )
  const user = useSelector((state: RootState) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin
  const [isQrLoginDialogOpen, setIsQrLoginDialogOpen] = useState(false)

  // Load download history so Select All can skip parts finished in
  // previous sessions. Merge by id so an in-flight fetch cannot wipe
  // entries added by history:entry_added while the request was out.
  useEffect(() => {
    let cancelled = false
    void getHistory()
      .then((loaded) => {
        if (cancelled) return
        const current = store.getState().history.entries
        const seen = new Set(current.map((entry) => entry.id))
        const merged = [...current]
        for (const entry of loaded) {
          if (!seen.has(entry.id)) merged.push(entry)
        }
        store.dispatch(setHistoryEntries(merged))
      })
      .catch(() => {
        // Select All still skips current-session queue items.
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      // Why: A bangumi season spans many pages, so a deep-link to one episode
      // (Video.epId, populated by the backend from the ep-id URL) must open on
      // that episode's page. Otherwise the user lands on page 1 and the single
      // auto-selected episode stays off-screen (selection logic lives in
      // lib/partSelection shouldSelectPart).
    } else if (video.contentType === 'bangumi' && video.epId !== undefined) {
      // Bangumi URL: jump to the page containing the requested episode
      const idx = video.parts.findIndex((p) => p.epId === video.epId)
      if (idx >= 0) page = Math.floor(idx / PARTS_PER_PAGE) + 1
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
  }, [
    browserPage,
    browserP,
    video.contentType,
    video.epId,
    video.parts,
    input.pendingDownload,
    input.url,
    totalPages,
  ])

  // Track scroll request timestamp to ensure each navigation triggers scroll
  const [scrollRequestId, setScrollRequestId] = useState(0)

  // Track previous pendingDownload to detect when it's cleared
  const prevPendingDownloadRef = useRef<typeof input.pendingDownload>(null)

  useEffect(() => {
    if (video.parts.length === 0 || isFetching) return

    let targetIndex: number | null = null

    if (browserP) {
      targetIndex = parseInt(browserP, 10) - 1
      // Why: Scrolls the targeted episode (Video.epId) into view to match the
      // page-jump and single-episode selection above, so the user immediately
      // sees the one part that was auto-selected.
    } else if (video.contentType === 'bangumi' && video.epId !== undefined) {
      // Bangumi URL: scroll to the requested episode
      const idx = video.parts.findIndex((p) => p.epId === video.epId)
      targetIndex = idx >= 0 ? idx : null
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
  }, [
    browserP,
    video.contentType,
    video.epId,
    video.parts,
    input.url,
    isFetching,
  ])

  // Trigger scroll after pendingDownload is cleared (video info fetch complete)
  useEffect(() => {
    const prevPending = prevPendingDownloadRef.current
    prevPendingDownloadRef.current = input.pendingDownload

    if (video.parts.length === 0 || isFetching) return

    if (prevPending && !input.pendingDownload) {
      const targetIndex = prevPending.page - 1
      const targetPage = Math.ceil(prevPending.page / PARTS_PER_PAGE)
      // Persist target page so the sidebar Home button restores it
      dispatch(setHomePage(targetPage))
      setScrollToPartIndex(targetIndex)
      setScrollRequestId((prev) => prev + 1)
    }
  }, [input.pendingDownload, video.parts.length, isFetching, dispatch])

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
      // Persist page so the sidebar Home button restores it
      dispatch(setHomePage(page))
      const cardContent = document.querySelector('[data-part-list]')
      if (cardContent) {
        cardContent.scrollTop = 0
      }
    },
    [searchParams, setSearchParams, dispatch],
  )

  /**
   * Handles pagination navigation. Selection is kept across pages so the
   * user can pick parts on every page (or use Select All) before downloading.
   *
   * @param page - The target page number (1-indexed)
   */
  const handlePageChange = useCallback(
    (page: number) => {
      if (page === currentPage) return
      performPageChange(page)
    },
    [currentPage, performPageChange],
  )

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

  // Track previous input.url to detect when URL actually changes
  const prevInputUrlRef = useRef(input.url)

  // Clear browser 'page' param when input URL changes (and has 'p' param)
  // This ensures correct page navigation when URL input changes
  // IMPORTANT: Only runs when input.url CHANGES, not when searchParams changes
  // to avoid interfering with pagination navigation
  useEffect(() => {
    const prevUrl = prevInputUrlRef.current
    prevInputUrlRef.current = input.url

    // Only run when input.url actually changes
    if (prevUrl === input.url) return
    if (!input.url) return

    try {
      const pParam = new URL(input.url).searchParams.get('p')
      if (pParam && searchParams.has('page')) {
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('page')
        setSearchParams(newParams, { replace: true })
      }
    } catch {
      // Invalid URL
    }
    // Note: searchParams is intentionally included in deps to read current state,
    // but the early return on prevUrl === input.url prevents infinite loops
  }, [input.url, setSearchParams, searchParams])

  const selectTooltip = hasActiveDownloads
    ? t('video.download_in_progress')
    : undefined

  // Select every part on every page except ones already downloaded
  const handleSelectAll = useCallback(() => {
    const skipIndices = collectDownloadedPartIndices({
      queue,
      historyEntries,
      videoBvid: video.bvid,
      partCount: video.parts.length,
      firstPartAid: video.parts[0]?.aid,
    })
    dispatch(selectAll({ skipIndices }))
  }, [dispatch, queue, historyEntries, video.bvid, video.parts])

  // Deselect every part on every page
  const handleDeselectAll = useCallback(() => {
    dispatch(deselectAll())
  }, [dispatch])

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
                      onClick={() => setIsQrLoginDialogOpen(true)}
                      className="inline cursor-pointer text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    />
                  ),
                  2: (
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

        {/* QR Code Login Dialog */}
        <QRCodeLoginDialog
          open={isQrLoginDialogOpen}
          onOpenChange={setIsQrLoginDialogOpen}
        />

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
                      label={t('video.select_all')}
                      onClick={handleSelectAll}
                      disabled={hasActiveDownloads}
                      tooltip={
                        selectTooltip ?? t('video.select_all_tooltip')
                      }
                    />
                    <TooltipButton
                      label={t('video.deselect_all')}
                      onClick={handleDeselectAll}
                      disabled={hasActiveDownloads}
                      tooltip={
                        selectTooltip ?? t('video.deselect_all_tooltip')
                      }
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
    </div>
  )
}

/**
 * Home page content component (main application view).
 *
 * This is the content portion of the home page without the layout wrapper.
 * It should be rendered inside a PageLayoutShell or similar layout.
 *
 * Redirects to /init if the app is not initialized.
 * Supports autoFetch query parameter to automatically fetch video info.
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
      <OpenDownloadStatusDialogButton />
    </VideoInfoProvider>
  )
}

export default HomeContent
