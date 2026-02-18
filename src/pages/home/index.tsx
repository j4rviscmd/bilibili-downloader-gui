import { store, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import {
  deselectAll,
  DownloadButton,
  selectAll,
  useVideoInfo,
  VideoForm1,
  VideoInfoProvider,
} from '@/features/video'
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
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import { Separator } from '@/shared/ui/separator'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Info } from 'lucide-react'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

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
  const user = useSelector((state) => state.user)
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

  const handleSelectAll = () => store.dispatch(selectAll())
  const handleDeselectAll = () => store.dispatch(deselectAll())
  const selectTooltip = hasActiveDownloads
    ? t('video.download_in_progress')
    : undefined

  return (
    <div className="flex h-full flex-col">
      {/* Step 1: Fixed Area (outside scroll) */}
      <div className="mx-auto w-full max-w-5xl px-3 pb-3 pt-3 sm:px-6">
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
        <ScrollArea style={{ height: 'calc(100dvh - 2.3rem - 140px)' }}>
            <div className="mx-auto w-full max-w-5xl px-3 pb-3 pt-3 sm:px-6">
              <Card>
                <CardHeader className="bg-card sticky top-0 z-10 pt-3 rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-lg">
                      {t('video.step2_title')}
                    </CardTitle>
                    {!isFetching && (
                      <div className="flex items-center gap-2">
                        <DownloadButton />
                        <TooltipButton
                          label={t('video.select_all')}
                          onClick={handleSelectAll}
                          disabled={hasActiveDownloads}
                          tooltip={selectTooltip}
                        />
                        <TooltipButton
                          label={t('video.deselect_all')}
                          onClick={handleDeselectAll}
                          disabled={hasActiveDownloads}
                          tooltip={selectTooltip}
                        />
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-0 pt-3">
                  {isFetching ? (
                    <VideoPartCardSkeleton />
                  ) : (
                    video.parts.map((_v, idx) => {
                      const isLast = idx === video.parts.length - 1

                      return (
                        <div key={idx}>
                          <VideoPartCard
                            video={video}
                            page={idx + 1}
                            isDuplicate={duplicateIndices.includes(idx)}
                          />
                          {!isLast && <Separator className="my-3" />}
                        </div>
                      )
                    })
                  )}
                </CardContent>
                {!isFetching && (
                  <CardFooter>
                    <DownloadButton />
                  </CardFooter>
                )}
              </Card>
            </div>
            <ScrollBar />
          </ScrollArea>
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
