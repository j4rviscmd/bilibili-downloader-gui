import { store } from '@/app/store'
import { setInitiated, setProcessingFnc } from '@/features/init/initSlice'
import { sleep } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'

export const initApp = async () => {
  console.log('Application initialization started')
  let isInitialized = false

  store.dispatch(setProcessingFnc('ℹ️ ffmpegの有効性チェック'))
  const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
  if (isValidFfmpeg) {
    store.dispatch(setProcessingFnc('✅ ffmpegの有効性チェックに成功しました'))
    isInitialized = true
  } else {
    store.dispatch(setProcessingFnc('ℹ️ ffmpegをインストールしています'))
    const isInstalled = await invoke('install_ffmpeg')
    if (isInstalled) {
      store.dispatch(setProcessingFnc('✅ ffmpegのインストールに成功しました'))
      isInitialized = true
    } else {
      store.dispatch(setProcessingFnc('😫 ffmpegのインストール失敗しました'))
    }
  }

  await sleep(1000)
  store.dispatch(setInitiated(true))
  console.log('Application initialization completed')

  return isInitialized
}
