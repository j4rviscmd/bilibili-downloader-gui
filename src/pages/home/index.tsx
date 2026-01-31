import { store } from '@/app/store'
import { useInit } from '@/features/init'
import { PageLayout } from '@/shared/layout'
import {
  deselectAll,
  DownloadButton,
  DownloadingDialog,
  selectAll,
  useVideoInfo,
  VideoForm1,
  VideoForm2,
} from '@/features/video'
import { Separator } from '@/shared/ui/separator'
import { Button } from '@/shared/ui/button'
import { useEffect } from 'react'
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
      <VideoForm1 />
      <Separator className="my-3" />
      {video.parts.length > 0 && (
        <div className="flex items-center gap-2 px-3">
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            {t('video.select_all')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDeselectAll}>
            {t('video.deselect_all')}
          </Button>
        </div>
      )}
      {video.parts.map((_v, idx) => (
        <VideoForm2
          key={idx}
          video={video}
          page={idx + 1}
          isDuplicate={duplicateIndices.includes(idx)}
        />
      ))}
      <div className="box-border flex w-full justify-center p-3">
        <DownloadButton />
      </div>
      <DownloadingDialog />
    </PageLayout>
  )
}

export default HomePage
