import { store } from '@/app/store'
import { setInitiated, setProcessingFnc } from '@/features/init/initSlice'
import { sleep } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'

export const initApp = async () => {
  console.log('Application initialization started')
  let isInitialized = false

  store.dispatch(setProcessingFnc('ffmpegの有効性チェック'))
  const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
  if (isValidFfmpeg) {
    store.dispatch(setProcessingFnc('ffmpegの有効性チェックに成功しました'))
    isInitialized = true
  } else {
    store.dispatch(setProcessingFnc('ffmpegをダウンロードしています'))
    const isInstalled = await invoke('install_ffmpeg')
    if (isInstalled) {
      isInitialized = true
    }
  }

  await sleep(1000)
  store.dispatch(setInitiated(true))
  console.log('Application initialization completed')

  // 初期化処理に失敗
  return isInitialized
}
