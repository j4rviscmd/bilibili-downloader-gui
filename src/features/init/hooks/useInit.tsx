import { interceptInvokeError } from '@/app/lib/invokeErrorHandler'
import { store, type RootState } from '@/app/store'
import { setInitiated as setValue } from '@/features/init/model/initSlice'
import { applyFontSize, parseFontSize } from '@/features/settings'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { setSidebarOpen } from '@/features/sidebar'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { logger } from '@/shared/lib/logger'
import { getOs } from '@/shared/os/api/getOs'
import { invoke } from '@tauri-apps/api/core'
import { exit } from '@tauri-apps/plugin-process'
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

/** Backend init result, produced by the `initialize` command during splash. */
export interface InitResult {
  settings?: Settings
  user?: User
  /** Error string from user-info fetch (undefined on success). */
  userError?: string
  ffmpegSuccess: boolean
}

/** Result of the (now thin) frontend init. */
export interface InitResultCode {
  code: number
  detail?: string
}

/**
 * Frontend init handoff hook.
 *
 * The heavy init (cleanup, ffmpeg, settings load, session restore, user fetch)
 * runs on the Rust side in the `initialize` command while the splash window is
 * visible. This hook reads the result via `get_init_result` and applies only
 * the frontend-specific bits (i18n, font size, sidebar state, user Redux), and
 * re-runs the same invoke-error interception as the previous getUserInfo
 * (e.g. ERR::UNAUTHORIZED → session-expiry toast).
 *
 * @returns Initiated flag and control methods (initApp, quitApp).
 */
export const useInit = () => {
  const initiated = useSelector((state: RootState) => state.init.initiated)

  const setInitiated = (value: boolean) => {
    store.dispatch(setValue(value))
  }

  const quitApp = async (): Promise<void> => {
    await exit()
  }

  const isSupportedLang = (lang: string): lang is SupportedLang =>
    (SUPPORTED_LANGS as readonly string[]).includes(lang)

  const applyLanguageSetting = async (
    language: string | undefined,
  ): Promise<void> => {
    if (!language) return
    try {
      const i18n = (await import('@/i18n')).default
      if (i18n.language !== language && isSupportedLang(language)) {
        logger.debug(`applyLanguageSetting: Applying language=${language}`)
        await changeLanguage(language)
      }
    } catch {
      // Silently ignore language setting failures (non-fatal).
    }
  }

  const initApp = async (): Promise<InitResultCode> => {
    logger.info('initApp: reading consolidated init result from backend')
    // OS detection is fire-and-forget (frontend-only, cheap).
    getOs()

    // Run backend initialization before reading the result. In normal mode the
    // splash window already ran `initialize`; it is idempotent (AtomicBool
    // guard in the backend), so this is a no-op then. In E2E mode there is no
    // splash window, so this is where init actually runs.
    await invoke('initialize').catch((e) => {
      logger.error('initApp: initialize failed', e)
    })

    let result: InitResult
    try {
      result = await invoke<InitResult>('get_init_result')
    } catch (e) {
      logger.error('initApp: failed to read init result, using defaults', e)
      result = {
        settings: undefined,
        user: undefined,
        userError: undefined,
        ffmpegSuccess: false,
      }
    }

    // Apply frontend-specific settings from the result.
    const settings = result.settings
    if (settings) {
      // Store into settingsSlice so the rest of the app (dialogs, selectors)
      // sees the persisted settings instead of defaults.
      store.dispatch(setSettings(settings))
    }
    await applyLanguageSetting(settings?.language)
    applyFontSize(parseFontSize(settings?.fontSize))
    if (settings?.sidebarExpanded !== undefined) {
      store.dispatch(setSidebarOpen(settings.sidebarExpanded))
    }

    // User info (undefined if not logged in / fetch failed).
    if (result.user) {
      store.dispatch(setUser(result.user))
    }

    setInitiated(true)

    // ffmpeg is required; if it failed to validate/install, surface an error
    // (mirrors the previous useInit behavior of returning code 1 → /error).
    if (!result.ffmpegSuccess) {
      logger.warn('initApp: ffmpeg unavailable')
      return { code: 1 }
    }

    // If the backend user fetch failed, run the same error interception as the
    // previous getUserInfo (e.g. ERR::UNAUTHORIZED → session-expiry toast),
    // instead of silently ignoring.
    if (result.userError) {
      await interceptInvokeError(store, result.userError)
    }

    logger.info('initApp: done')
    return { code: 0 }
  }

  return {
    initiated,
    setInitiated,
    initApp,
    quitApp,
  }
}
