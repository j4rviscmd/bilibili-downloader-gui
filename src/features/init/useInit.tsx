import { store, type RootState } from '@/app/store'
import {
  setProcessingFnc,
  setInitiated as setValue,
} from '@/features/init/initSlice'
import { sleep } from '@/lib/utils'
import { useUser } from '@/shared/user/useUser'
import { invoke } from '@tauri-apps/api/core'
import { exit } from '@tauri-apps/plugin-process'
import { useSelector } from 'react-redux'

export const useInit = () => {
  const { getUserInfo } = useUser()
  const initiated = useSelector((state: RootState) => state.init.initiated)
  const progress = useSelector((state: RootState) => state.progress)
  const processingFnc = useSelector(
    (state: RootState) => state.init.processingFnc,
  )

  const setInitiated = (value: boolean) => {
    store.dispatch(setValue(value))
  }

  const quitApp = async (): Promise<void> => {
    await exit()
  }

  // TODO: invokeはapi/へ移動する
  const initApp = async (): Promise<number> => {
    console.log('Application initialization started')
    /*
     * 返却コード一覧
     *  0: 正常終了
     *  1: ffmpegのチェック失敗
     *  2: Cookieのチェック失敗
     *  3: ユーザ情報の取得失敗(未ログイン)
     *  4: ユーザ情報の取得失敗(未ログイン以外)
     *  255: 想定外エラー
     */
    let resCode = 255
    const isValidFfmpeg = await checkFfmpeg()
    if (isValidFfmpeg) {
      const isValidCookie = await checkCookie()
      if (isValidCookie) {
        // Cookieよりユーザ情報を取得
        const user = await getUserInfo()
        if (user && user.data.isLogin) {
          resCode = 0
        } else {
          resCode = 3
        }
      } else {
        resCode = 2
      }
    } else {
      resCode = 1
    }

    await sleep(500)
    setInitiated(true)
    console.log('Application initialization completed')

    return resCode
  }

  const checkFfmpeg = async (): Promise<boolean> => {
    let res = false

    setMessage('ℹ️ ffmpegの有効性チェック中...')
    const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
    if (isValidFfmpeg) {
      setMessage('✅ ffmpegの有効性チェックに成功しました')
      res = true
    } else {
      setMessage('ℹ️ ffmpegをインストールしています')
      const isInstalled = await invoke('install_ffmpeg')
      if (isInstalled) {
        setMessage('✅ ffmpegのインストールに成功しました')
        await sleep(1000)
        res = true
      } else {
        setMessage('😫 ffmpegのインストール失敗しました')
      }
    }

    return res
  }

  const checkCookie = async (): Promise<boolean> => {
    let res = false

    // Cookieの有効性チェック
    // 有効な場合、アプリメモリに保存(By backend) & ログインユーザ名の取得
    const isValid = await invoke('get_cookie')
    if (isValid) {
      setMessage('✅ Cookieの取得に成功しました')
      res = true
    } else {
      setMessage('😫 Cookieの取得に失敗しました')
      res = true
    }

    return res
  }

  const setMessage = (message: string) => {
    store.dispatch(setProcessingFnc(message))
  }

  return {
    initiated,
    progress,
    processingFnc,
    setInitiated,
    initApp,
    quitApp,
  }
}
