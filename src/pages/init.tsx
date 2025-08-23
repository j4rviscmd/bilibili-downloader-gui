import { store } from '@/app/store'
import CircleIndicator from '@/components/lib/CircleIndicator'
import ProgressStatusBar from '@/components/lib/Progress'
import { useInit } from '@/features/init/useInit'
import { sleep } from '@/lib/utils'
import { clearProgress } from '@/shared/progress/progressSlice'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

function InitPage() {
  const navigate = useNavigate()
  const { progress, processingFnc, initApp } = useInit()
  const { t } = useTranslation()

  useEffect(() => {
    progress.forEach((p) => {
      if (p.isComplete) {
        sleep(500).then(() => {
          store.dispatch(clearProgress())
        })
      }
    })
  }, [progress])

  useEffect(() => {
    ;(async () => {
      const resCode = await initApp()
      if (resCode === 0) {
        navigate('/home')
      } else if (resCode === 1) {
        // ffmpegチェックエラー
        navigate('/error', { state: { errorCode: 1 }, replace: true })
      } else if (resCode === 2) {
        // Cookieチェックエラー
        navigate('/error', { state: { errorCode: 2 }, replace: true })
      } else if (resCode === 3) {
        // ユーザ情報取得エラー
        navigate('/error', { state: { errorCode: 3 }, replace: true })
      } else if (resCode === 4) {
        // ユーザ情報取得エラー(未ログイン以外)
        navigate('/error', { state: { errorCode: 4 }, replace: true })
      } else if (resCode === 5) {
        // アップデートチェックエラー
        navigate('/error', { state: { errorCode: 5 }, replace: true })
      } else {
        // 想定外エラー
        navigate('/error', { state: { errorCode: 255 }, replace: true })
      }
    })()
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
