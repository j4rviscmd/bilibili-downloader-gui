import { store, type RootState } from '@/app/store'
import {
  setProcessingFnc,
  setInitiated as setValue,
} from '@/features/init/model/initSlice'
import { useSettings } from '@/features/settings/useSettings'
import { useUser } from '@/features/user/useUser'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { sleep } from '@/shared/lib/utils'
import { getOs } from '@/shared/os/api/getOs'
import { invoke } from '@tauri-apps/api/core'
import { exit } from '@tauri-apps/plugin-process'
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
   * Type guard to check if a string is a supported language.
   */
  const isSupportedLang = (lang: string): lang is SupportedLang => {
    return ['en', 'ja', 'fr', 'es', 'zh', 'ko'].includes(lang)
  }

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
   * 2. App settings retrieval and language application
   * 3. ffmpeg validation/installation
   * 4. Cookie validation
   * 5. User authentication check
   *
   * Note: Version checking is handled separately by UpdaterProvider
   * which displays a non-blocking dialog when updates are available.
   *
   * TODO: Move invoke calls to api/ directory.
   *
   * @returns A status code indicating the result:
   * - 0: Success
   * - 1: ffmpeg check failed
   * - 2: Cookie check failed
   * - 3: User info fetch failed (not logged in)
   * - 4: User info fetch failed (other error)
   * - 255: Unexpected error
   */
  const initApp = async (): Promise<number> => {
    console.log('Application initialization started')
    // Fire & forget OS detection (don't await)
    getOs().then((os) => console.log('Detected OS:', os))

    // Early exit on version check failure
    if (!(await checkVersion())) {
      await finalizeInit(5)
      return 5
    }

    const settings = await getAppSettings()
    await applyLanguageSetting(settings?.language)

    // Early exit on ffmpeg check failure
    if (!(await checkFfmpeg())) {
      await finalizeInit(1)
      return 1
    }

    // Cookie check (continue for non-logged-in users even without cookie)
    await checkCookie()
    // Fetch user info and store in Redux (hasCookie=false if no cookie)
    await getUserInfo()

    await finalizeInit(0)
    return 0
  }

  /**
   * Finalizes initialization by setting flag and sleeping briefly.
   */
  const finalizeInit = async (code: number): Promise<void> => {
    await sleep(500)
    setInitiated(true)
    console.log('Application initialization completed with code:', code)
  }

  /**
   * Applies language setting if different from current.
   */
  const applyLanguageSetting = async (
    language: string | undefined,
  ): Promise<void> => {
    if (!language) return

    try {
      const i18n = (await import('@/i18n')).default
      if (i18n.language !== language) {
        setMessage(t('init.applying_language', { lang: language }))
        // Type guard: ensure language is a SupportedLang
        if (isSupportedLang(language)) {
          await changeLanguage(language)
          setMessage(t('init.applied_language', { lang: language }))
        }
      }
    } catch (e) {
      console.warn('Failed to apply language setting', e)
    }
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
   * Checks the application version.
   *
   * Version checking is handled by UpdaterProvider which displays
   * a non-blocking dialog when updates are available. This function
   * always returns true to allow initialization to continue.
   *
   * @returns Always true to continue initialization.
   */
  const checkVersion = async (): Promise<boolean> => {
    // Version check is now handled by UpdaterProvider with user dialog
    // Always return true to continue initialization
    return true
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
    // Cookie check (detailed results hidden - use generic progress message)
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
