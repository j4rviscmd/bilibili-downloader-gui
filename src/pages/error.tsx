import { Button } from '@/components/ui/button'
import { useInit } from '@/features/init/useInit'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

function ErrorPage() {
  const location = useLocation()
  const { errorCode } = location.state || { errorCode: 0 }
  const { quitApp } = useInit()
  const { t } = useTranslation()
  const onClickUri = async () => {
    console.log('on click')
    await openUrl('https://www.bilibili.com')
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
            {errorCode === 1 ? (
              t('errorPage.ffmpeg_not_found')
            ) : errorCode === 2 ? (
              t('errorPage.cookie_invalid')
            ) : errorCode === 3 ? (
              <>
                <span>{t('errorPage.user_info_failed')}</span>
                <div>
                  {t('errorPage.visit_and_login')}{' '}
                  <Button
                    asChild
                    className="mx-1 h-6 p-1 hover:cursor-pointer"
                    onClick={onClickUri}
                  >
                    <a target="_black">bilibili.com</a>
                  </Button>
                </div>
              </>
            ) : errorCode === 4 ? (
              t('errorPage.user_info_failed_other')
            ) : errorCode === 5 ? (
              t('errorPage.version_check_failed')
            ) : (
              t('errorPage.unexpected')
            )}
          </span>
        </div>
        <div className="text-muted-foreground text-sm">
          {t('errorPage.code_label')} {errorCode}
        </div>
      </div>
      <Button onClick={quitApp} variant={'destructive'} className="m-3 p-3">
        {t('errorPage.quit_app')}
      </Button>
    </div>
  )
}

export default ErrorPage
