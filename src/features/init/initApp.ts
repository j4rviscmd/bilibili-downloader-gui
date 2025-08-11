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
    }
  }

  await sleep(500)
  store.dispatch(setInitiated(true))
  console.log('Application initialization completed')

  return isInitialized
}

const checkFfmpeg = async (): Promise<boolean> => {
  let res = false

  store.dispatch(setProcessingFnc('ℹ️ ffmpegの有効性チェック'))
  const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
  if (isValidFfmpeg) {
    store.dispatch(setProcessingFnc('✅ ffmpegの有効性チェックに成功しました'))
    res = true
  } else {
    store.dispatch(setProcessingFnc('ℹ️ ffmpegをインストールしています'))
    const isInstalled = await invoke('install_ffmpeg')
    if (isInstalled) {
      store.dispatch(setProcessingFnc('✅ ffmpegのインストールに成功しました'))
      await sleep(1000)
      res = true
    } else {
      store.dispatch(setProcessingFnc('😫 ffmpegのインストール失敗しました'))
    }
  }

  return res
}

const checkCookie = async (): Promise<boolean> => {
  // Cookieの有効性チェック
  // 有効な場合、アプリメモリに保存(by backend)
  const isValid = await invoke('get_cookie')
  if (isValid) {
    //
  }

  return true
}
