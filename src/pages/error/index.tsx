import { useInit } from '@/features/init'
import { Button } from '@/shared/ui/button'
import { openUrl } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

/**
 * Props for ErrorMessage component.
 */
interface ErrorMessageProps {
  /** Initialization error code */
  errorCode: number
  /** Optional error detail from backend */
  errorDetail?: string
  /** Callback to open Bilibili in browser */
  onClickUri: () => void
}

/**
 * Renders the appropriate error message based on error code.
 *
 * Error codes:
 * - 1: ffmpeg not found
 * - 2: Cookie invalid
 * - 3: User info failed (not logged in)
 * - 4: User info failed (other error)
 * - 5: Version check failed
 * - 6: Settings initialization failed
 * - default: Unexpected error
 *
 * @param props - Component props
 */
function ErrorMessage({
  errorCode,
  errorDetail,
  onClickUri,
}: ErrorMessageProps): ReactNode {
  const { t } = useTranslation()

  switch (errorCode) {
    case 1:
      return t('errorPage.ffmpeg_not_found')
    case 2:
      return t('errorPage.cookie_invalid')
    case 3:
      return (
        <>
          <span>{t('errorPage.user_info_failed')}</span>
          <div>
            {t('errorPage.visit_and_login')}{' '}
            <Button
              asChild
              className="mx-1 h-6 p-1 hover:cursor-pointer"
              onClick={onClickUri}
            >
              <a target="_blank">bilibili.com</a>
            </Button>
          </div>
        </>
      )
    case 4:
      return t('errorPage.user_info_failed_other')
    case 5:
      return t('errorPage.version_check_failed')
    case 6:
      return (
        <>
          <span>{t('errorPage.settings_init_failed')}</span>
          {errorDetail && (
            <div className="text-muted-foreground mt-1 max-w-md break-all text-center font-mono text-xs">
              {errorDetail}
            </div>
          )}
        </>
      )
    default:
      return t('errorPage.unexpected')
  }
}

/**
 * Error page component.
 *
 * Displays when initialization fails. Shows the error message, error code,
 * and a button to quit the application. For login errors, provides a link
 * to open Bilibili in the browser.
 *
 * @example
 * ```tsx
 * <Route path="/error" element={<ErrorPage />} />
 * ```
 */
function ErrorPage() {
  const location = useLocation()
  const { errorCode, errorDetail } = location.state || { errorCode: 0 }
  const { quitApp } = useInit()
  const { t } = useTranslation()

  const handleOpenBilibili = async () => {
    await openUrl('https://www.bilibili.com')
  }

  const handleRelaunch = async () => {
    await relaunch()
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="text-muted-foreground text-center text-2xl font-bold">
        <div>
          <span className="text-red-500">🚨</span>
          <span>{t('errorPage.title')}</span>
        </div>
        <div>
          <span>{t('errorPage.cannot_continue')}</span>
        </div>
      </div>
      <div className="flex flex-col items-center">
        <div className="text-muted-foreground text-md">
          <span>{t('errorPage.message_label')} </span>
          <span>
            <ErrorMessage
              errorCode={errorCode}
              errorDetail={errorDetail}
              onClickUri={handleOpenBilibili}
            />
          </span>
        </div>
        <div className="text-muted-foreground text-sm">
          {t('errorPage.code_label')} {errorCode}
        </div>
      </div>
      {errorCode === 6 && (
        <div className="text-muted-foreground text-sm">
          {t('errorPage.try_restart')}
        </div>
      )}
      <div className="flex gap-3 m-3">
        {errorCode === 6 && (
          <Button onClick={handleRelaunch} variant="default" className="p-3">
            {t('errorPage.restart_app')}
          </Button>
        )}
        <Button onClick={quitApp} variant="destructive" className="p-3">
          {t('errorPage.quit_app')}
        </Button>
      </div>
    </div>
  )
}

export default ErrorPage
