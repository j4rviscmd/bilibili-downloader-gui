import type { RootState } from '@/app/store'
import { store, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import type { Video } from '@/features/video'
import {
  deselectAll,
  DownloadButton,
  selectAll,
  useVideoInfo,
  VideoForm1,
  VideoInfoProvider,
} from '@/features/video'
import { fetchPartQualities } from '@/features/video/api/fetchVideoInfo'
import { createConcurrencyLimiter } from '@/features/video/lib/concurrency'
import {
  setPartQualities,
  setQualitiesLoading,
} from '@/features/video/model/inputSlice'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import VideoPartCardSkeleton from '@/features/video/ui/VideoPartCardSkeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
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
import { Separator } from '@/shared/ui/separator'
import { Skeleton } from '@/shared/ui/skeleton'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import type { ListRange } from 'react-virtuoso'
import { Virtuoso } from 'react-virtuoso'

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

/** Approximate height of each VideoPartCard in pixels. */
const DEFAULT_PART_HEIGHT = 220

/** Props for the ScrollablePartList component. */
type ScrollablePartListProps = {
  video: Video
  duplicateIndices: number[]
  isFetching: boolean
}

/**
 * Concurrency limiter for API calls.
 *
 * Limits quality fetch API calls to 3 concurrent requests to avoid 429 rate limiting.
 * Kept outside component lifecycle to persist across re-renders.
 */
const qualityLimiter = createConcurrencyLimiter(3)

/**
 * Fetches quality info for parts in the specified index range.
 *
 * Skips parts that are already fetched or loading, and limits
 * concurrent execution via the concurrency limiter.
 *
 * @param video - Video information
 * @param startIndex - Start index of the range
 * @param endIndex - End index of the range
 */
function fetchQualitiesForRange(
  video: Video,
  startIndex: number,
  endIndex: number,
) {
  const state = store.getState()
  for (let i = startIndex; i <= endIndex; i++) {
    const part = video.parts[i]
    if (!part) continue
    const partInput = state.input.partInputs[i]
    // Skip if already fetched or loading
    if (
      partInput?.qualitiesLoading ||
      (partInput?.videoQualities?.length ?? 0) > 0
    ) {
      continue
    }
    store.dispatch(setQualitiesLoading({ index: i, loading: true }))
    qualityLimiter
      .run(() => fetchPartQualities(video.bvid, part.cid))
      .then(([vq, aq]) => {
        store.dispatch(
          setPartQualities({
            index: i,
            videoQualities: vq,
            audioQualities: aq,
          }),
        )
      })
      .catch((e) => {
        console.error('Failed to fetch qualities:', e)
        store.dispatch(
          setPartQualities({
            index: i,
            videoQualities: [],
            audioQualities: [],
          }),
        )
      })
  }
}

/**
 * Virtualized part list that replaces the previous ScrollArea.
 *
 * Uses `react-virtuoso` to render only visible VideoPartCards,
 * significantly reducing DOM nodes for videos with many parts.
 *
 * Quality info fetching is handled via `rangeChanged` callback
 * to detect visible range, executed through the concurrency limiter.
 * Individual `VideoPartCard` components do not fetch qualities.
 *
 * @param props.video - Video information
 * @param props.duplicateIndices - Indices of parts with duplicate titles
 * @param props.isFetching - Whether video info is being fetched
 *
 * @private
 */
/** Debounce time to detect scroll stop (ms) */
const RANGE_DEBOUNCE_MS = 300

function ScrollablePartList({
  video,
  duplicateIndices,
  isFetching,
}: ScrollablePartListProps) {
  const lastRangeRef = useRef<ListRange | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const itemContent = useCallback(
    (idx: number) => (
      <div>
        <VideoPartCard
          video={video}
          page={idx + 1}
          isDuplicate={duplicateIndices.includes(idx)}
        />
        {idx < video.parts.length - 1 && <Separator className="my-3" />}
      </div>
    ),
    [video, duplicateIndices],
  )

  const Footer = useCallback(
    () => (
      <CardFooter>
        <DownloadButton />
      </CardFooter>
    ),
    [],
  )

  const computeItemKey = useCallback(
    (idx: number) => video.parts[idx].cid,
    [video.parts],
  )

  /**
   * Virtuoso visible range change callback (with debounce).
   *
   * Fetches quality info for parts in the final visible range
   * after scroll stops for RANGE_DEBOUNCE_MS.
   * Parts passed during fast scrolling are not fetched.
   */
  const handleRangeChanged = useCallback(
    (range: ListRange) => {
      lastRangeRef.current = range
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      debounceRef.current = setTimeout(() => {
        fetchQualitiesForRange(video, range.startIndex, range.endIndex)
      }, RANGE_DEBOUNCE_MS)
    },
    [video],
  )

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Fetch quality for initial visible range when video changes
  useEffect(() => {
    if (video.parts.length > 0 && lastRangeRef.current) {
      fetchQualitiesForRange(
        video,
        lastRangeRef.current.startIndex,
        lastRangeRef.current.endIndex,
      )
    }
  }, [video])

  if (isFetching) {
    return (
      <CardContent className="space-y-0">
        <VideoPartCardSkeleton />
      </CardContent>
    )
  }

  return (
    <Virtuoso
      style={{ height: 'calc(100dvh - 2.3rem - 13.5rem)' }}
      totalCount={video.parts.length}
      defaultItemHeight={DEFAULT_PART_HEIGHT}
      increaseViewportBy={200}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      rangeChanged={handleRangeChanged}
      components={{ Footer }}
    />
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
 * - Select all / Deselect all buttons
 * - Download button
 * - Auto-fetch via autoFetch query parameter
 *
 * @private
 */
function HomeContentInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { video, duplicateIndices, onValid1, isFetching } = useVideoInfo()
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const user = useSelector((state: RootState) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  // Handle autoFetch from query parameter
  useEffect(() => {
    const autoFetchUrl = searchParams.get('autoFetch')
    if (autoFetchUrl && !isFetching && video.parts.length === 0) {
      searchParams.delete('autoFetch')
      setSearchParams(searchParams, { replace: true })
      onValid1(autoFetchUrl)
    }
  }, [searchParams, isFetching, video.parts.length, onValid1, setSearchParams])

  const selectDisabled = hasActiveDownloads
  const selectTooltip = hasActiveDownloads
    ? t('video.download_in_progress')
    : undefined

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

      {/* Step 2: Scrollable Area */}
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
                      onClick={() => store.dispatch(selectAll())}
                      disabled={selectDisabled}
                      tooltip={selectTooltip}
                    />
                    <TooltipButton
                      label={t('video.deselect_all')}
                      onClick={() => store.dispatch(deselectAll())}
                      disabled={selectDisabled}
                      tooltip={selectTooltip}
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            <ScrollablePartList
              video={video}
              duplicateIndices={duplicateIndices}
              isFetching={isFetching}
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
 * Displays the primary UI for video downloads including:
 * - Video URL input form (Step 1)
 * - Video parts configuration forms (Step 2)
 * - Select all/deselect all buttons
 * - Download button
 * - Download progress (inline in each part card)
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
