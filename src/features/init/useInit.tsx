import { store, type RootState } from '@/app/store'
import {
  setProcessingFnc,
  setInitiated as setValue,
} from '@/features/init/initSlice'
import { sleep } from '@/lib/utils'
import { changeLanguage } from '@/shared/i18n'
import { useSettings } from '@/shared/settings/useSettings'
import { useUser } from '@/shared/user/useUser'
import { invoke } from '@tauri-apps/api/core'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

export const useInit = () => {
  const { getUserInfo } = useUser()
  const { getSettings } = useSettings()
  const { t } = useTranslation()

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
     *  5: アプリバージョンのチェック失敗
     *  255: 想定外エラー
     */
    let resCode = 255
    const settings = await getAppSettings()
    // 設定言語適用（main.tsx 初期化後に遅延適用する）
    if (settings?.language) {
      try {
        if ((await import('@/i18n')).default.language !== settings.language) {
          setMessage(t('init.applying_language', { lang: settings.language }))
          await changeLanguage(settings.language)
          setMessage(t('init.applied_language', { lang: settings.language }))
          // 言語は即反映したいので`sleep`させない
          // await sleep(500)
        }
      } catch (e) {
        console.warn('Failed to apply language setting', e)
      }
    }
    const isValidVersion = await checkVersion()
    if (isValidVersion) {
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
    } else {
      resCode = 5
    }

    await sleep(500)
    setInitiated(true)
    console.log('Application initialization completed')

    return resCode
  }

  const checkFfmpeg = async (): Promise<boolean> => {
    let res = false

    setMessage(t('init.checking_ffmpeg'))
    const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
    if (isValidFfmpeg) {
      setMessage(t('init.ffmpeg_ok'))
      res = true
    } else {
      setMessage(t('init.installing_ffmpeg'))
      const isInstalled = await invoke('install_ffmpeg')
      if (isInstalled) {
        setMessage(t('init.ffmpeg_install_ok'))
        await sleep(1000)
        res = true
      } else {
        setMessage(t('init.ffmpeg_install_failed'))
      }
    }

    return res
  }

  const getAppSettings = async () => {
    setMessage(t('init.fetch_settings'))
    await sleep(300)
    const settings = await getSettings()
    return settings
  }

  /**
   * アプリバージョンのチェック
   * すでに最新である場合、0.5sほど「お使いのアプリは最新です」を表示される
   * 最新ではない場合、強制アップデートを行う
   * @returns {Promise<void>}
   */
  const checkVersion = async (): Promise<boolean> => {
    // 開発環境ではアップデートチェックをスキップ
    if (import.meta.env.DEV) {
      setMessage(t('init.dev_skip_version'))
      await sleep(500)
      return true
    }

    setMessage(t('init.checking_version'))
    try {
      const update = await checkUpdate()
      if (!update) {
        // すでに最新
        setMessage(t('init.latest_version'))
        await sleep(500)
        return true
      }

      // 強制アップデートを実施
      const ver = update.version ?? 'latest'
      setMessage(t('init.downloading_update', { ver }))
      await update.downloadAndInstall()

      setMessage(t('init.update_done_restart'))
      await sleep(1500)
      await relaunch()
      return false
    } catch (e) {
      console.error('Version check/update failed:', e)
      setMessage(t('init.update_failed'))
      return false
    }
  }

  const checkCookie = async (): Promise<boolean> => {
    let res = false

    // Cookieの有効性チェック
    // 有効な場合、アプリメモリに保存(By backend) & ログインユーザ名の取得
    const isValid = await invoke('get_cookie')
    if (isValid) {
      setMessage(t('init.cookie_success'))
      res = true
    } else {
      setMessage(t('init.cookie_failed'))
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
