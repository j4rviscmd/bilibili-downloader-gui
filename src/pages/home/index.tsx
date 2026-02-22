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
 * API呼び出しの同時実行数リミッター。
 *
 * 最大3並列で画質取得APIを呼び出し、429レート制限を回避する。
 * コンポーネントのライフサイクル外で保持し、再レンダリングで
 * リセットされないようにする。
 */
const qualityLimiter = createConcurrencyLimiter(3)

/**
 * 指定されたインデックス範囲のパートの画質情報を取得する。
 *
 * 既に取得済み・ロード中のパートはスキップし、
 * concurrency limiter で同時実行数を制限する。
 *
 * @param video - 動画情報
 * @param startIndex - 範囲の開始インデックス
 * @param endIndex - 範囲の終了インデックス
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
    // 既に取得済みまたはロード中ならスキップ
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
 * 画質情報の取得は `rangeChanged` コールバックで可視範囲を
 * 検知し、concurrency limiter 経由で順次実行する。
 * 個々の `VideoPartCard` では画質取得を行わない。
 *
 * @private
 */
/** スクロール停止を検出するデバウンス時間（ms） */
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
   * Virtuoso の可視範囲変更コールバック（デバウンス付き）。
   *
   * スクロールが停止してから RANGE_DEBOUNCE_MS 後に、
   * 最終的な可視範囲のパートの画質情報を取得する。
   * 高速スクロールで通過しただけのパートはコール対象外。
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

  // デバウンスタイマーのクリーンアップ
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // 動画が変わった時に初期可視範囲の画質を取得
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
  const selectTooltip = selectDisabled
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
