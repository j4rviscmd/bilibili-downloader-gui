import { store } from '@/app/store'
import { useInit } from '@/features/init'
import {
  deselectAll,
  DownloadButton,
  DownloadingDialog,
  selectAll,
  useVideoInfo,
  VideoForm1,
} from '@/features/video'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { PageLayout } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Separator } from '@/shared/ui/separator'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Home page component (main application view).
 *
 * Displays the primary UI for video downloads including:
 * - Sidebar with settings button
 * - App bar with user info, language selector, and theme toggle
 * - Video URL input form (Step 1)
 * - Video parts configuration forms (Step 2)
 * - Select all/deselect all buttons
 * - Download button
 * - Download progress dialog
 *
 * Redirects to /init if the app is not initialized.
 *
 * @example
 * ```tsx
 * <Route path="/home" element={<HomePage />} />
 * ```
 */
function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { video, duplicateIndices } = useVideoInfo()
  const { t } = useTranslation()
  const isMobile = useIsMobile()

  // Collapsed parts state for mobile (parts 3+ are collapsed by default on mobile)
  const [collapsedParts, setCollapsedParts] = useState<Set<number>>(
    new Set(),
  )

  // Initialize collapsed parts for mobile (parts 3+ are collapsed)
  useEffect(() => {
    if (isMobile && video.parts.length > 2) {
      setCollapsedParts(new Set(Array.from({ length: video.parts.length - 2 }, (_, i) => i + 2)))
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
    <PageLayout>
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
                <Button variant="outline" size="sm" onClick={handleSelectAll}>
                  {t('video.select_all')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeselectAll}
                >
                  {t('video.deselect_all')}
                </Button>
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
                      className="w-full mb-2 h-9"
                    >
                      {isCollapsed ? (
                        <>
                          <span>▶ Part {idx + 1} を展開</span>
                        </>
                      ) : (
                        <>
                          <span>▼ Part {idx + 1} を折りたたむ</span>
                        </>
                      )}
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

      <DownloadingDialog />
    </PageLayout>
  )
}

export default HomePage
