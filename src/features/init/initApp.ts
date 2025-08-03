import { store } from '@/app/store'
import { setInitiated, setProcessingFnc } from '@/features/init/initSlice'
import { invoke } from '@tauri-apps/api/core'

export const initApp = async () => {
  console.log('Application initialization started')

  store.dispatch(setProcessingFnc('ffmpegの有効性チェック'))
  const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
  if (!isValidFfmpeg) {
    store.dispatch(setProcessingFnc('ffmpegをダウンロードします'))
    // await invoke('download_ffmpeg')
  }

  store.dispatch(setInitiated(true))
  console.log('Application initialization completed')

  return true
}
