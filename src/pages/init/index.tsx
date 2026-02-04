import { store } from '@/app/store'
import { useInit } from '@/features/init'
import { clearProgress } from '@/shared/progress/progressSlice'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import ProgressStatusBar from '@/shared/ui/Progress'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Initialization page component.
 *
 * Displays during app startup while running the initialization sequence:
 * - Version check and auto-update
 * - Settings retrieval
 * - ffmpeg validation/installation
 * - Cookie validation
 * - User authentication
 *
 * Shows a loading spinner, status messages, and progress bars for downloads
 * (e.g., ffmpeg installation). Redirects to /home on success or /error on failure.
 *
 * @example
 * ```tsx
 * <Route path="/init" element={<InitPage />} />
 * ```
 */
function InitPage() {
  const navigate = useNavigate()
  const { progress, processingFnc, initApp } = useInit()
  const { t } = useTranslation()

  useEffect(() => {
    progress.forEach((p) => {
      if (p.isComplete) {
        store.dispatch(clearProgress())
      }
    })
  }, [progress])

  useEffect(() => {
    const runInit = async (): Promise<void> => {
      const resCode = await initApp()
      if (resCode === 0) {
        navigate('/home')
        return
      }
      // Error codes: 1=ffmpeg, 2=Cookie, 3=not logged in, 4=user info, 5=update check
      const errorCode = [1, 2, 3, 4, 5].includes(resCode) ? resCode : 255
      navigate('/error', { state: { errorCode }, replace: true })
    }

    runInit()
     
  }, [])

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-full flex-col items-center">
        <CircleIndicator />
        <div className="text-muted-foreground text-center text-xl font-bold">
          {t('init.initializing')}
        </div>
        <div className="text-muted-foreground text-sm">{processingFnc}</div>
        {progress.length > 0 &&
          progress.map((p) => {
            return (
              <div key={p.downloadId} className="w-full max-w-[20rem] p-3">
                <ProgressStatusBar progress={p} />
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default InitPage
