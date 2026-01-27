import { store } from '@/app/store'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import ProgressStatusBar from '@/shared/ui/Progress'
import { useInit } from '@/features/init'
import { sleep } from '@/shared/lib/utils'
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
        return
      }
      // エラーコード: 1=ffmpeg, 2=Cookie, 3=未ログイン, 4=ユーザ情報, 5=更新確認
      const errorCode = [1, 2, 3, 4, 5].includes(resCode) ? resCode : 255
      navigate('/error', { state: { errorCode }, replace: true })
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
