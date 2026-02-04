import { store, type RootState } from '@/app/store'
import {
  setProcessingFnc,
  setInitiated as setValue,
} from '@/features/init/model/initSlice'
import { useSettings } from '@/features/settings/useSettings'
import { useUser } from '@/features/user/useUser'
import { changeLanguage } from '@/shared/i18n'
import { sleep } from '@/shared/lib/utils'
import { getOs } from '@/shared/os/api/getOs'
import { invoke } from '@tauri-apps/api/core'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/**
 * Custom hook for managing application initialization sequence.
 *
 * Orchestrates the startup process including version checking, ffmpeg
 * validation/installation, cookie retrieval, user authentication, and
 * settings application. Provides status messages for each initialization
 * step and handles errors gracefully.
 *
 * @returns An object containing initialization state and control methods.
 *
 * @example
 * ```typescript
 * const {
 *   initiated,
 *   processingFnc,
 *   initApp,
 *   quitApp
 * } = useInit()
 *
 * const resultCode = await initApp()
 * if (resultCode !== 0) {
 *   // Handle initialization error
 *   console.error('Init failed with code:', resultCode)
 * }
 * ```
 */
export const useInit = () => {
  const { getUserInfo } = useUser()
  const { getSettings } = useSettings()
  const { t } = useTranslation()

  const initiated = useSelector((state: RootState) => state.init.initiated)
  const progress = useSelector((state: RootState) => state.progress)
  const processingFnc = useSelector(
    (state: RootState) => state.init.processingFnc,
  )

  /**
   * Sets the initialization completion flag.
   *
   * @param value - True when initialization is complete.
   */
  const setInitiated = (value: boolean) => {
    store.dispatch(setValue(value))
  }

  /**
   * Exits the application.
   *
   * Invokes the Tauri process exit function to terminate the app.
   */
  const quitApp = async (): Promise<void> => {
    await exit()
  }

  /**
   * Executes the application initialization sequence.
   *
   * Performs the following steps in order:
   * 1. OS detection (fire-and-forget)
   * 2. Version check and auto-update (skipped in dev mode)
   * 3. App settings retrieval and language application
   * 4. ffmpeg validation/installation
   * 5. Cookie validation
   * 6. User authentication check
   *
   * TODO: Move invoke calls to api/ directory.
   *
   * @returns A status code indicating the result:
   * - 0: Success
   * - 1: ffmpeg check failed
   * - 2: Cookie check failed
   * - 3: User info fetch failed (not logged in)
   * - 4: User info fetch failed (other error)
   * - 5: Version check failed
   * - 255: Unexpected error
   */
  const initApp = async (): Promise<number> => {
    console.log('Application initialization started')
    // Fire & forget OS detection (don't await)
    getOs().then((os) => console.log('Detected OS:', os))
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
    const isValidVersion = await checkVersion()
    if (isValidVersion) {
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
      const isValidFfmpeg = await checkFfmpeg()
      if (isValidFfmpeg) {
        // Cookieチェック（非ログインユーザ対応：Cookieがなくても続行）
        await checkCookie()
        // ユーザ情報を取得してReduxストアに保存（Cookieがない場合はhasCookie=false）
        await getUserInfo()
        // Cookieの有無に関わらず正常終了
        resCode = 0
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

  /**
   * Validates ffmpeg installation and installs if missing.
   *
   * Checks if ffmpeg is available in the system. If not found,
   * automatically downloads and installs it. Displays status messages
   * during the process.
   *
   * @returns True if ffmpeg is valid or successfully installed,
   * false otherwise.
   */
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
        res = true
      } else {
        setMessage(t('init.ffmpeg_install_failed'))
      }
    }

    return res
  }

  /**
   * Retrieves application settings from persistent storage.
   *
   * @returns The app settings object or undefined if retrieval fails.
   */
  const getAppSettings = async () => {
    setMessage(t('init.fetch_settings'))
    const settings = await getSettings()
    return settings
  }

  /**
   * Checks the application version and performs auto-update if needed.
   *
   * In development mode, this check is skipped. In production, if an
   * update is available, it downloads and installs automatically, then
   * relaunches the app. If the app is already up-to-date, displays a
   * confirmation message for 0.5s.
   *
   * @returns True if version is valid (latest or successfully updated),
   * false if update check fails.
   */
  const checkVersion = async (): Promise<boolean> => {
    // 開発環境ではアップデートチェックをスキップ
    if (import.meta.env.DEV) {
      setMessage(t('init.dev_skip_version'))
      return true
    }

    setMessage(t('init.checking_version'))
    try {
      const update = await checkUpdate()
      if (!update) {
        // すでに最新
        setMessage(t('init.latest_version'))
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

  /**
   * Validates Bilibili cookies from Firefox.
   *
   * Attempts to retrieve valid Bilibili authentication cookies from the
   * Firefox browser. If valid cookies are found, they are cached in the
   * backend for subsequent API requests.
   *
   * Note: Always returns true to allow non-logged-in users to proceed.
   *
   * @returns True to continue initialization.
   */
  const checkCookie = async (): Promise<boolean> => {
    // Cookieチェック（詳細な結果は非表示）
    // 設定取得と同じメッセージを使用して、進行中であることを示す
    await invoke('get_cookie')

    return true
  }

  /**
   * Updates the current initialization status message.
   *
   * @param message - The localized status message to display.
   */
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
