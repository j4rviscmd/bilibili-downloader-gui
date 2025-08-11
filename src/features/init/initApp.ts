import { store } from '@/app/store'
import { setInitiated, setProcessingFnc } from '@/features/init/initSlice'
import { sleep } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'

export const initApp = async () => {
  console.log('Application initialization started')
  let isInitialized = false
  const isValidFfmpeg = await checkFfmpeg()
  if (isValidFfmpeg) {
    const isValidCookie = await checkCookie()
    if (isValidCookie) {
      isInitialized = true
    } else {
      isInitialized = false
    }
  }

  await sleep(500)
  store.dispatch(setInitiated(true))
  console.log('Application initialization completed')

  return isInitialized
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
  // 有効な場合、アプリメモリに保存(By backend)
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
