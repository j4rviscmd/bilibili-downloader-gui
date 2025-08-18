import { Button } from '@/components/ui/button'
import { useInit } from '@/features/init/useInit'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useLocation } from 'react-router'

function ErrorPage() {
  const location = useLocation()
  const { errorCode } = location.state || { errorCode: 0 }
  const { quitApp } = useInit()
  const onClickUri = async () => {
    console.log('on click')
    await openUrl('https://www.bilibili.com')
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="text-muted-foreground text-center text-2xl font-bold">
        <div>
          <span className="text-red-500">🚨</span>
          <span>エラーが発生しました</span>
        </div>
        <div>
          <span>アプリを続行することができません</span>
        </div>
      </div>
      <div className="flex flex-col items-center">
        <div className="text-muted-foreground text-md">
          <span>エラーメッセージ: </span>
          <span>
            {errorCode === 1 ? (
              'ffmpegが見つかりません。'
            ) : errorCode === 2 ? (
              'Cookieが無効です。'
            ) : errorCode === 3 ? (
              <>
                <span>ユーザ情報が取得できませんでした</span>
                <div>
                  Firefoxで
                  <Button
                    asChild
                    className="mx-1 h-6 p-1 hover:cursor-pointer"
                    onClick={onClickUri}
                  >
                    <a target="_black">bilibili.com</a>
                  </Button>
                  にログインしていることを確認してください
                </div>
              </>
            ) : errorCode === 4 ? (
              'ユーザ情報が取得できません（未ログイン以外）。'
            ) : errorCode === 5 ? (
              'アプリバージョンのチェックに失敗しました。'
            ) : (
              '想定外のエラーが発生しました。'
            )}
          </span>
        </div>
        <div className="text-muted-foreground text-sm">
          エラーコード: {errorCode}
        </div>
      </div>
      <Button onClick={quitApp} variant={'destructive'} className="m-3 p-3">
        アプリを終了する
      </Button>
    </div>
  )
}

export default ErrorPage
