import { store, type RootState } from '@/app/store'
import {
  setProcessingFnc,
  setInitiated as setValue,
} from '@/features/init/model/initSlice'
import {
  checkCookieRefresh,
  getLoginMethod,
  loadQrSession,
  qrLogout,
  refreshCookie,
} from '@/features/login'
import { applyFontSize, parseFontSize } from '@/features/settings'
import { useSettings } from '@/features/settings/useSettings'
import { setSidebarOpen } from '@/features/sidebar'
import { notifyInitComplete } from '@/features/splash'
import { useUser } from '@/features/user'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { logger } from '@/shared/lib/logger'
import { sleep } from '@/shared/lib/utils'
import { getOs } from '@/shared/os/api/getOs'
import { invoke } from '@tauri-apps/api/core'
import { exit } from '@tauri-apps/plugin-process'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/** Languages supported by the application's i18n configuration. */
const SUPPORTED_LANGS: readonly SupportedLang[] = [
  'en',
  'ja',
  'fr',
  'es',
  'zh',
  'ko',
]

/** Result of the application initialization sequence. */
export interface InitResult {
  /** Status code: 0 for success, non-zero for failure. */
  code: number
  /** Optional error detail when initialization fails. */
  detail?: string
}

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
 * const result = await initApp()
 * if (result.code !== 0) {
 *   // Handle initialization error
 *   console.error('Init failed with code:', result.code, 'detail:', result.detail)
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
   *
   * Narrows an opaque `string` (typically read from persisted settings)
   * to `SupportedLang` so it can be passed to `changeLanguage` without
   * further runtime checks.
   */
  const isSupportedLang = (lang: string): lang is SupportedLang =>
    (SUPPORTED_LANGS as readonly string[]).includes(lang)

  /**
   * Dispatches the initiated flag to the Redux store.
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
   * 4. QR session restoration (if exists)
   * 5. Firefox cookie validation (fallback)
   * 6. User authentication check
   *
   * Note: Version checking is handled separately by UpdaterProvider
   * which displays a non-blocking dialog when updates are available.
   *
   * TODO: Move invoke calls to api/ directory.
   *
   * @returns An object containing status code and optional error detail:
   * - 0: Success
   * - 1: ffmpeg check failed
   */
  const initApp = async (): Promise<InitResult> => {
    logger.info('initApp: Starting initialization')

    // Fire & forget OS detection (don't await)
    getOs()

    // Clean up orphaned temp files from previous sessions. Awaited so the
    // status label stays visible during cleanup (mirroring the ffmpeg
    // check step), even though it usually completes in a blink.
    setMessage(t('init.cleanup_in_progress'))
    try {
      const result = await invoke<{
        deletedCount: number
        failedCount: number
      }>('cleanup_temp_files')
      if (result.deletedCount > 0 || result.failedCount > 0) {
        setMessage(
          t('init.cleanup_completed', {
            deleted: result.deletedCount,
            failed: result.failedCount,
          }),
        )
      }
    } catch {
      // Silently ignore cleanup failures (non-fatal for startup)
    }

    // Version checking is handled by UpdaterProvider (non-blocking dialog)
    const settings = await getAppSettings()
    const skipSplash = settings?.skipSplashAnimation ?? false
    await applyLanguageSetting(settings?.language)
    applyFontSize(parseFontSize(settings?.fontSize))

    // Preload sidebar state to prevent layout shift on main page render
    if (settings?.sidebarExpanded !== undefined) {
      store.dispatch(setSidebarOpen(settings.sidebarExpanded))
    }

    // Early exit on ffmpeg check failure
    if (!(await checkFfmpeg())) {
      logger.warn('initApp: ffmpeg check failed')
      await finalizeInit(skipSplash)
      return { code: 1 }
    }

    // Honor the user-selected login method strictly. No cross-method
    // fallback: if the user chose QR but has no session, they stay logged
    // out (and can switch to Firefox in Settings).
    const loginMethod = await getLoginMethod()
    if (loginMethod === 'qrCode') {
      await checkQrSession()
    } else {
      await checkCookie()
    }

    // Fetch user info and store in Redux (hasCookie=false if no cookie)
    await getUserInfo()

    await finalizeInit(skipSplash)
    logger.info('initApp: Initialization completed successfully')
    return { code: 0 }
  }

  /**
   * Finalizes initialization by setting flag and sleeping briefly.
   *
   * Marks the app as initialized in the Redux store and notifies the splash
   * screen so it can tear down. The 500ms sleep lets the splash animation
   * finish naturally unless `skipSplash` is `true`, in which case the sleep
   * is skipped entirely.
   *
   * @param skipSplash - When `true`, omits the 500ms splash-animation pause.
   */
  const finalizeInit = async (skipSplash: boolean): Promise<void> => {
    logger.debug('finalizeInit: Finalizing initialization')
    if (!skipSplash) {
      await sleep(500)
    }
    setInitiated(true)
    notifyInitComplete()
  }

  /**
   * Applies language setting if different from current.
   *
   * Loads the i18n bundle dynamically, compares the persisted language
   * preference to the active i18n language, and calls `changeLanguage`
   * when they differ. Status messages are dispatched before and after the
   * switch. Failures are swallowed because an unsupported language value
   * should not block startup.
   *
   * @param language - Persisted language code. Early return when falsy.
   */
  const applyLanguageSetting = async (
    language: string | undefined,
  ): Promise<void> => {
    if (!language) return

    try {
      const i18n = (await import('@/i18n')).default
      if (i18n.language !== language) {
        logger.debug(`applyLanguageSetting: Applying language=${language}`)
        setMessage(t('init.applying_language', { lang: language }))
        // Type guard: ensure language is a SupportedLang
        if (isSupportedLang(language)) {
          await changeLanguage(language)
          setMessage(t('init.applied_language', { lang: language }))
        }
      }
    } catch {
      // Silently ignore language setting failures
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
    setMessage(t('init.checking_ffmpeg'))
    const isValidFfmpeg = await invoke<boolean>('validate_ffmpeg')
    if (isValidFfmpeg) {
      logger.info('checkFfmpeg: ffmpeg is valid')
      setMessage(t('init.ffmpeg_ok'))
      return true
    }

    logger.info('checkFfmpeg: Installing ffmpeg')
    setMessage(t('init.installing_ffmpeg'))
    const isInstalled = await invoke<boolean>('install_ffmpeg')
    if (isInstalled) {
      logger.info('checkFfmpeg: ffmpeg installed successfully')
      setMessage(t('init.ffmpeg_install_ok'))
      return true
    }

    logger.error('checkFfmpeg: ffmpeg installation failed')
    setMessage(t('init.ffmpeg_install_failed'))
    return false
  }

  /**
   * Retrieves application settings and updates the init status message.
   *
   * Wraps `useSettings().getSettings` purely so the init screen can show a
   * localized "fetching settings" message while the Tauri store is read.
   *
   * @returns The current application settings, or `undefined` if the
   * underlying store lookup returns nothing.
   */
  const getAppSettings = async () => {
    setMessage(t('init.fetch_settings'))
    return getSettings()
  }

  /**
   * Retrieves cookies from the local Firefox profile via the Tauri backend.
   *
   * This is used as a fallback when no QR session is available.
   *
   * @returns Always returns `true` after invocation completes.
   */
  const checkCookie = async (): Promise<boolean> => {
    logger.debug('checkCookie: Checking Firefox cookies')
    await invoke('get_cookie')
    return true
  }

  /**
   * Restores previously saved QR code login session.
   *
   * Attempts to load a stored QR session from persistent storage and
   * populate the cookie cache. This takes priority over Firefox cookies
   * for users who logged in via QR code.
   *
   * Also checks if cookie refresh is needed and performs it if required.
   *
   * @returns True if a QR session was successfully restored, false otherwise.
   */
  const checkQrSession = async (): Promise<boolean> => {
    try {
      const loaded = await loadQrSession()
      if (!loaded) {
        return false
      }

      // Check if cookie refresh is needed
      const refreshInfo = await checkCookieRefresh()
      logger.info('refreshCookie: refreshInfo')
      if (!refreshInfo.refresh) {
        setMessage(t('init.qr_session_restored', 'Restored login session'))
        return true
      }

      try {
        await refreshCookie()
        setMessage(t('init.cookie_refreshed', 'Login session refreshed'))
        return true
      } catch (e) {
        logger.error(
          'refreshCookie: Cookie refresh failed, clearing session',
          e,
        )
        try {
          await qrLogout()
        } catch (logoutErr) {
          logger.error('refreshCookie: Failed to clear session', logoutErr)
        }
        return false
      }
    } catch {
      return false
    }
  }

  /**
   * Dispatches an initialization step message to the Redux store.
   *
   * The message is displayed to the user on the initialization screen
   * to indicate the current progress step.
   *
   * @param message - The status message to display.
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
