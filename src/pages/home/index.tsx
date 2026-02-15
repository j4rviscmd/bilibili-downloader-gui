import { store, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import {
  deselectAll,
  DownloadButton,
  selectAll,
  useVideoInfo,
  VideoForm1,
} from '@/features/video'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { useIsMobile } from '@/shared/hooks/use-mobile'
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
import { openUrl } from '@tauri-apps/plugin-opener'
import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const { video, duplicateIndices, onValid1, isFetching } = useVideoInfo()
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const user = useSelector((state) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  // Collapsed parts state for mobile (parts 3+ are collapsed by default on mobile)
  const [collapsedParts, setCollapsedParts] = useState<Set<number>>(new Set())

  // Handle autoFetch from query parameter
  useEffect(() => {
    const autoFetchUrl = searchParams.get('autoFetch')
    if (autoFetchUrl && !isFetching && video.parts.length === 0) {
      searchParams.delete('autoFetch')
      setSearchParams(searchParams, { replace: true })
      onValid1(autoFetchUrl)
    }
  }, [searchParams, isFetching, video.parts.length, onValid1, setSearchParams])

  // Initialize collapsed parts for mobile (parts 3+ are collapsed)
  useEffect(() => {
    if (isMobile && video.parts.length > 2) {
      setCollapsedParts(
        new Set(
          Array.from({ length: video.parts.length - 2 }, (_, i) => i + 2),
        ),
      )
    }
  }, [isMobile, video.parts.length])

  const togglePartCollapsed = (index: number) => {
    setCollapsedParts((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    store.dispatch(selectAll())
  }

  const handleDeselectAll = () => {
    store.dispatch(deselectAll())
  }

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <>
      {/* Login Benefits Info - shown only when not logged in */}
      {!isLoggedIn && (
        <Alert variant="info">
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

      {/* Step 2: Video Parts Configuration */}
      {video.parts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-lg">
                {t('video.step2_title')}
              </CardTitle>
              <div className="flex items-center gap-2">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAll}
                          disabled={hasActiveDownloads}
                        >
                          {t('video.select_all')}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {hasActiveDownloads && (
                      <TooltipContent side="top" arrow>
                        {t('video.download_in_progress')}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDeselectAll}
                          disabled={hasActiveDownloads}
                        >
                          {t('video.deselect_all')}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {hasActiveDownloads && (
                      <TooltipContent side="top" arrow>
                        {t('video.download_in_progress')}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            {video.parts.map((_v, idx) => {
              const isCollapsed = collapsedParts.has(idx)
              const showCollapseButton = isMobile && idx >= 2
              const isLast = idx === video.parts.length - 1

              return (
                <div key={idx}>
                  {showCollapseButton && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePartCollapsed(idx)}
                      className="mb-2 h-9 w-full"
                    >
                      <span>
                        {isCollapsed
                          ? t('video.expand_part', { num: idx + 1 })
                          : t('video.collapse_part', { num: idx + 1 })}
                      </span>
                    </Button>
                  )}
                  {!isCollapsed && (
                    <>
                      <VideoPartCard
                        video={video}
                        page={idx + 1}
                        isDuplicate={duplicateIndices.includes(idx)}
                      />
                      {!isLast && <Separator className="my-3" />}
                    </>
                  )}
                </div>
              )
            })}
          </CardContent>
          <CardFooter>
            <DownloadButton />
          </CardFooter>
        </Card>
      )}
    </>
  )
}

export default HomeContent
