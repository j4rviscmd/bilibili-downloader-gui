import type { RootState } from '@/app/store'
import { useAppDispatch, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import { QRCodeLoginDialog } from '@/features/login'
import type { Video } from '@/features/video'
import {
  PARTS_PER_PAGE,
  resetVideo,
  resetVideoView,
  setHomePage,
  setInput,
  setVideo,
  useVideoInfo,
  VideoInfoProvider,
} from '@/features/video'
import type { PreviewTarget } from '@/features/video-search'
import { VideoPreviewDialog } from '@/features/video-search'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import { scrollElementWithinScroller } from '@/shared/lib/scroll'
import { Skeleton } from '@/shared/ui/skeleton'
import { Info } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import BatchSettingsBar from './BatchSettingsBar'
import CommandBar from './CommandBar'
import DownloadDock from './DownloadDock'
import RecentUrls from './RecentUrls'
import VideoHeroCard from './VideoHeroCard'
import { videoSnapshots } from './videoHistoryCache'

// Shared inline-link styling for the two buttons inside the notice.
const loginLinkClass =
  'text-brand-strong dark:text-brand inline cursor-pointer font-semibold underline'

/**
 * Slim one-line login notice shown while logged out.
 *
 * Replaces the old full-size Alert: the restriction is surfaced where it
 * matters (quality context) without claiming permanent vertical space.
 * Reuses the existing login-benefits copy and QR login dialog.
 *
 * @private
 */
function LoginNotice({ onOpenQr }: { onOpenQr: () => void }) {
  return (
    <div
      data-login-notice
      className="bg-brand-strong/10 border-brand-strong/30 text-foreground flex w-full max-w-2xl items-start gap-2.5 rounded-lg border px-3.5 py-2 text-xs"
    >
      <Info
        className="text-brand-strong dark:text-brand mt-0.5 size-4 shrink-0"
        aria-hidden
      />
      <div className="min-w-0">
        <span data-login-notice-text>
          <Trans
            i18nKey="video.login_benefits_description"
            components={{
              1: (
                <button
                  type="button"
                  onClick={onOpenQr}
                  className={loginLinkClass}
                />
              ),
            }}
          />
        </span>
      </div>
    </div>
  )
}

/**
 * Skeleton matching the loaded layout (compact bar + hero + part rows), so
 * an explicit fetch never causes a layout shift when data lands.
 *
 * @private
 */
function LoadedSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="bg-card flex gap-4 rounded-xl border p-4">
        <Skeleton className="aspect-video w-40 shrink-0 rounded-lg md:w-62" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3.5 w-2/5" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-18 rounded-full" />
          </div>
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="bg-card flex items-center gap-3 rounded-xl border p-3"
        >
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-8 rounded-full" />
          <Skeleton className="aspect-video w-26 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Props for the PaginatedPartList component. @private */
type PaginatedPartListProps = {
  video: Video
  duplicateIndices: number[]
  /** Part index range (0-based, inclusive) for the visible page. */
  pageRange: { startIndex: number; endIndex: number }
  onPreview: (target: PreviewTarget) => void
  scrollToPartIndex: number | null
  scrollRequestId: number
}

/**
 * Part rows for the current page. Scroll-into-view on deep link, preview
 * dialog hookup, and the `data-part-list` E2E marker are preserved from the
 * previous implementation. Pagination lives in the bottom dock instead of
 * a footer here.
 *
 * @private
 */
function PaginatedPartList({
  video,
  duplicateIndices,
  pageRange: { startIndex, endIndex },
  onPreview,
  scrollToPartIndex,
  scrollRequestId,
}: PaginatedPartListProps) {
  // Unique per (video, part, scroll request): each navigation triggers a
  // new scroll even back to a previously scrolled part.
  const scrollKey = `${video.bvid}-${scrollToPartIndex}-${scrollRequestId}`

  // Track which scrollKey has been scrolled
  const scrolledKeysRef = useRef<Set<string>>(new Set())

  // Scroll to specific part on initial load (when p=n is specified)
  useEffect(() => {
    if (
      scrollToPartIndex !== null &&
      scrollToPartIndex >= startIndex &&
      scrollToPartIndex <= endIndex &&
      !scrolledKeysRef.current.has(scrollKey)
    ) {
      scrolledKeysRef.current.add(scrollKey)
      // Whole-page scroll: reveal the part by scrolling ONLY the page
      // scroller (scrollIntoView would drag the overflow-hidden app shell
      // along — see scrollElementWithinScroller's docstring).
      setTimeout(() => {
        const targetPart = document.querySelector<HTMLElement>(
          `[data-part-index="${scrollToPartIndex}"]`,
        )
        if (targetPart) {
          scrollElementWithinScroller(targetPart, 20)
        }
      }, 100)
    }
  }, [scrollToPartIndex, scrollKey, startIndex, endIndex])

  // Clean up old scroll keys when video changes (keep only recent ones)
  useEffect(() => {
    if (scrolledKeysRef.current.size > 10) {
      scrolledKeysRef.current = new Set()
    }
  }, [video.bvid])

  const pageParts = useMemo(
    () =>
      video.parts.slice(startIndex, endIndex + 1).map((part, offset) => {
        const index = startIndex + offset
        return (
          <div key={part.cid} data-part-index={index}>
            <VideoPartCard
              video={video}
              page={index + 1}
              isDuplicate={duplicateIndices.includes(index)}
              onThumbnailClick={() =>
                onPreview({
                  bvid: video.bvid,
                  title: part.part,
                  page: index + 1,
                })
              }
            />
          </div>
        )
      }),
    [video, duplicateIndices, startIndex, endIndex, onPreview],
  )

  return (
    // data-part-list stays on the list container: E2E selectors scope to it
    // (helpers/selectors.ts DATA_PART_LIST) and use its existence as the
    // parts-loaded signal.
    <div data-part-list className="flex flex-col gap-2">
      {pageParts}
    </div>
  )
}

/**
 * Internal search page content component.
 *
 * Single-flow composition (URL acquisition redesign): command bar → video
 * hero → part rows → bottom dock. Wizard step cards are gone; the empty,
 * fetching and loaded states each render the same skeleton of surfaces so
 * transitions never reflow the page.
 *
 * @private
 */
function SearchContentInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    video,
    videoId,
    duplicateIndices,
    onValid1,
    isFetching,
    isSilentFetching,
    input,
    selectedCount,
  } = useVideoInfo()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const user = useSelector((state: RootState) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin
  const [isQrLoginDialogOpen, setIsQrLoginDialogOpen] = useState(false)
  // Page-level scroll container (whole-page scroll, Qiita-style): its
  // scrollbar rides the window edge. State (not a ref) because the page
  // change reset below reads it inside a callback.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  // Fetch in flight that the UI should reflect (explicit submit). The
  // silent auto-fetch on input pause is excluded from the dock gating
  // below — but NOT from the fetching view: any fetch swaps the empty
  // state for the skeleton screen (mockup state B).
  const isExplicitFetching = isFetching && !isSilentFetching

  // Canonical id of the video currently in the store, derived the same
  // way the context derives `videoId` from the typed URL (videos use the
  // bvid, bangumi the first part's av id).
  const loadedVideoId = useMemo(
    () =>
      video.parts.length === 0
        ? null
        : video.contentType === 'bangumi'
          ? `av${video.parts[0]?.aid ?? ''}`
          : video.bvid,
    [video],
  )
  // Fetching a DIFFERENT video while one is already loaded: the store
  // still holds the previous video's parts, so without this the stale
  // content stayed on screen (with only the input spinner as feedback)
  // until the new data landed. Same-video refetch keeps the content.
  const isSwitchingVideo =
    isFetching &&
    loadedVideoId !== null &&
    videoId !== null &&
    videoId !== loadedVideoId

  // ---- History navigation: back/forward walks the empty page and each
  // fetched video, mirroring the video-search page's ?q= entries (one
  // ?url= entry per fetched video). Three cooperating pieces:
  // 1. the mirror effect snapshots the loaded state under its URL —
  //    slices are immutable, so the snapshot holds references only,
  // 2. the layout sync effect below aligns store ↔ entry BEFORE paint
  //    (restore from snapshot, fresh fetch, or view reset), so the
  //    wrong video never flashes,
  // 3. the push branch records the entry once a fetch lands.
  const urlParam = searchParams.get('url')
  const { pathname } = useLocation()
  // The store holds a fully-landed video matching the typed URL — the
  // state both effects below mirror and record under input.url.
  const hasLandedVideo =
    Boolean(input.url) &&
    video.parts.length > 0 &&
    videoId != null &&
    videoId === loadedVideoId

  // Continuous mirror: while a fully-landed video is displayed, keep the
  // latest edits (filenames, selections, resolved quality) cached under
  // its URL so a later back/forward restores them exactly.
  useEffect(() => {
    if (!hasLandedVideo || isFetching) return
    videoSnapshots.set(input.url, { video, input })
  }, [hasLandedVideo, input, video, isFetching])

  // One fresh fetch per URL per mount: a failed fetch leaves the hero
  // view; revisiting that entry must not retry the request forever.
  const attemptedUrlsRef = useRef(new Set<string>())
  const prevUrlParamRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    // Hidden-copy guard: the persistent layout keeps this page mounted
    // (display:none) while another page is active, and searchParams then
    // describe THAT page's location — not ours. Syncing from the hidden
    // copy would wipe the loaded video on every page leave and stamp a
    // junk ?url= entry onto the other page's history when an in-flight
    // fetch lands. prevUrlParamRef stays frozen, so the first sync after
    // returning compares against the last entry seen while this page was
    // active — the same hidden idle-copy hazard the video-search page
    // documents for its /popular redirect.
    if (pathname !== '/search') return
    // A fetch in flight owns the store (the landing commit re-runs this
    // effect); pendingDownload owns the next fetch — neither may be
    // fought over by an entry sync.
    if (isFetching || input.pendingDownload) return

    const urlParamChanged = prevUrlParamRef.current !== urlParam
    prevUrlParamRef.current = urlParam

    if (urlParamChanged) {
      if (!urlParam) {
        // Arrived at the empty entry via back/forward: drop the loaded
        // view so the hero shows (the snapshot was mirrored above, so
        // forward restores the video). pendingDownload is excluded at
        // the top — it owns the next fetch, not the entry.
        if (video.parts.length > 0) {
          dispatch(resetVideoView())
          dispatch(resetVideo())
        }
        return
      }
      // Arrived at a video entry via back/forward: instant snapshot
      // restore when this session loaded it before, fresh fetch once
      // otherwise.
      if (input.url === urlParam && video.parts.length > 0) return
      const snap = videoSnapshots.get(urlParam)
      if (snap) {
        dispatch(setVideo(snap.video))
        dispatch(setInput(snap.input))
        return
      }
      if (!attemptedUrlsRef.current.has(urlParam)) {
        attemptedUrlsRef.current.add(urlParam)
        void onValid1(urlParam)
      }
      return
    }

    // Entry unchanged but a fetch landed on it (Enter submit, silent
    // auto-fetch, RecentUrls re-fetch): record the entry. Layout timing
    // keeps the compact view and the new entry in the same paint.
    if (hasLandedVideo && urlParam !== input.url) {
      setSearchParams({ url: input.url })
    }
  }, [
    urlParam,
    pathname,
    isFetching,
    input.url,
    input.pendingDownload,
    video.parts.length,
    hasLandedVideo,
    dispatch,
    onValid1,
    setSearchParams,
  ])

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

    // An explicit `?p=N` (router param or the pasted input URL) outranks the
    // bangumi epId: an `av…?p=N` URL resolves to a bangumi whose top-level
    // epId points at the DEFAULT episode (episode 1), so honoring epId first
    // pinned the page to 1 no matter which p the URL named — the same
    // priority mistake the selection and scroll fixes already corrected.
    const pParam =
      browserP ??
      (() => {
        try {
          return input.url ? new URL(input.url).searchParams.get('p') : null
        } catch {
          return null
        }
      })()

    if (browserPage) {
      page = parseInt(browserPage, 10)
    } else if (pParam) {
      page = Math.ceil(parseInt(pParam, 10) / PARTS_PER_PAGE)
    } else if (video.contentType === 'bangumi' && video.epId !== undefined) {
      // Why: A bangumi season spans many pages, so a deep-link to one episode
      // (Video.epId, populated by the backend from the ep-id URL) must open on
      // that episode's page. Otherwise the user lands on page 1 and the single
      // auto-selected episode stays off-screen (selection logic lives in
      // lib/partSelection shouldSelectPart).
      const idx = video.parts.findIndex((p) => p.epId === video.epId)
      if (idx >= 0) page = Math.floor(idx / PARTS_PER_PAGE) + 1
    } else if (input.pendingDownload) {
      page = Math.ceil(input.pendingDownload.page / PARTS_PER_PAGE)
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

    // `?p=N` first (router param or the pasted input URL) — an
    // `av…?p=N` URL resolves to a bangumi whose top-level epId points at
    // the DEFAULT episode (episode 1), so honoring epId first scrolled to
    // the top no matter which p the URL named (same root cause as the
    // selection priority fix in shouldSelectPart).
    const pParam =
      browserP ??
      (() => {
        try {
          return input.url ? new URL(input.url).searchParams.get('p') : null
        } catch {
          return null
        }
      })()
    if (pParam) {
      targetIndex = parseInt(pParam, 10) - 1
    } else if (video.contentType === 'bangumi' && video.epId !== undefined) {
      // Bangumi URL (no ?p): scroll to the requested episode
      const idx = video.parts.findIndex((p) => p.epId === video.epId)
      targetIndex = idx >= 0 ? idx : null
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
      // Reset to the new page's first part
      if (scrollEl) scrollEl.scrollTop = 0
    },
    [searchParams, setSearchParams, dispatch, scrollEl],
  )

  /**
   * Handles pagination navigation.
   *
   * Navigates immediately even with parts selected (issue #691): selections
   * live in `partInputs` independent of the visible page, and a later
   * Download enqueues ALL selected parts — so paging with selections kept
   * is now the intended multi-page batch flow.
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

  /**
   * Part index range (0-based, inclusive) for the currently visible page.
   * Used to scope select/deselect operations to the current page only.
   */
  const pageRange = useMemo(() => {
    const startIndex = (currentPage - 1) * PARTS_PER_PAGE
    const endIndex = Math.min(
      startIndex + PARTS_PER_PAGE - 1,
      video.parts.length - 1,
    )
    return { startIndex, endIndex }
  }, [currentPage, video.parts.length])

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

  // Shared preview dialog (hero thumbnail + part thumbnails)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)

  // Any in-flight fetch — explicit 取得 press OR the debounced auto-fetch —
  // swaps the empty state for the fetching view (compact bar + skeleton),
  // per the mockup's state B. Keeping the hero visible until data lands
  // left the only feedback as the input's inline spinner.
  const hasContent = video.parts.length > 0 || isFetching
  const isLoaded =
    video.parts.length > 0 && !isExplicitFetching && !isSwitchingVideo
  const totalSelectedSeconds = useMemo(
    () =>
      input.partInputs
        .filter((pi) => pi.selected)
        .reduce((s, pi) => s + pi.duration, 0),
    [input.partInputs],
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Page-level scroll container: the scrollbar rides the window edge
          (Qiita-style, mirroring PageTemplate's `bodyScroll` mode). This
          page owns its wrappers (no PageTemplate header), so it repeats
          PageTemplate.tsx's max-w-[104rem] rail token and must stay in
          lockstep with it. The bottom dock is a flex sibling BELOW this
          scroller so pagination and the download CTA stay reachable
          without scrolling. */}
      <div
        ref={setScrollEl}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[104rem] flex-col pt-3">
          <QRCodeLoginDialog
            open={isQrLoginDialogOpen}
            onOpenChange={setIsQrLoginDialogOpen}
          />

          {hasContent ? (
            <>
              <CommandBar variant="compact" />
              <div className="px-3 pt-3 sm:px-6">
                {video.parts.length === 0 || isSwitchingVideo ? (
                  <LoadedSkeleton />
                ) : (
                  <>
                    <VideoHeroCard
                      video={video}
                      onOpenLogin={() => setIsQrLoginDialogOpen(true)}
                    />
                    <BatchSettingsBar />
                    <div className="mt-5 mb-2 flex flex-wrap items-baseline gap-2.5 px-0.5">
                      <h3 className="text-sm font-bold">
                        {t('search.parts_title')}
                      </h3>
                      <span className="text-muted-foreground text-xs">
                        {t('search.showing_range', {
                          from: pageRange.startIndex + 1,
                          to: pageRange.endIndex + 1,
                          total: video.parts.length,
                        })}
                      </span>
                    </div>
                    <PaginatedPartList
                      video={video}
                      duplicateIndices={duplicateIndices}
                      pageRange={pageRange}
                      onPreview={setPreview}
                      scrollToPartIndex={scrollToPartIndex}
                      scrollRequestId={scrollRequestId}
                    />
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pt-3 pb-6">
              <CommandBar variant="hero" />
              <RecentUrls onRefetch={(url) => void onValid1(url)} />
              {!isLoggedIn && (
                <LoginNotice onOpenQr={() => setIsQrLoginDialogOpen(true)} />
              )}
            </div>
          )}
        </div>
      </div>
      {/* Bottom dock: always visible once parts are loaded — pagination
          must not require scrolling to the list end (the previous sticky
          footer invariant), and the fixed height keeps the scroller
          resize-stable across selection changes. */}
      {isLoaded && (
        <DownloadDock
          totalPages={totalPages}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          selectedCount={selectedCount}
          totalSeconds={totalSelectedSeconds}
        />
      )}
      {/* Why showDownload=false: the download action hands off to this
          very page (usePendingDownload navigates to /search) — here the
          user already has the parts open, so only the preview and
          browser actions make sense. */}
      <VideoPreviewDialog
        entry={preview}
        onClose={() => setPreview(null)}
        showDownload={false}
      />
    </div>
  )
}

/**
 * Search page content component (main application view, issue #691).
 *
 * Wraps the inner content in the video info provider so URL fetching,
 * part selection and download state are shared across the command bar,
 * hero card, part rows and dock.
 */
export function SearchContent() {
  const { initiated } = useInit()
  const navigate = useNavigate()

  useEffect(() => {
    if (!initiated) {
      navigate('/init', { replace: true })
    }
  }, [initiated, navigate])

  if (!initiated) return null

  return (
    <VideoInfoProvider>
      <SearchContentInner />
    </VideoInfoProvider>
  )
}

export default SearchContent
