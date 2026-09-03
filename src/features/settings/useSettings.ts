import { store, useSelector } from '@/app/store'
import {
  callGetSettings,
  callPatchSettings,
  callUpdateLibPath,
} from '@/features/settings/api/settingApi'
import { languages } from '@/features/settings/language/languages'
import { setOpenDialog, setSettings } from '@/features/settings/settingsSlice'
import type { Settings, SettingsPatch } from '@/features/settings/type'
import type { SupportedLang } from '@/i18n'
import { changeLanguage } from '@/shared/i18n'
import { logger } from '@/shared/lib/logger'
import { toast } from '@/shared/ui/toast'
import { t as staticT, t } from 'i18next'
import { useCallback } from 'react'

/**
 * Hook for managing application settings.
 *
 * Provides access to current settings and methods to update them.
 * Settings changes are persisted to the backend and trigger UI updates.
 * Includes error handling with localized toast notifications for
 * validation errors (e.g., invalid path, permission denied, disk full).
 *
 * @returns Settings state and mutation methods
 *
 * @example
 * ```typescript
 * const { settings, updateLanguage, saveByForm } = useSettings()
 *
 * // Change language
 * await updateLanguage('ja')
 *
 * // Save settings from form
 * await saveByForm({ dlOutputPath: '/downloads', language: 'en' })
 *
 * // Save settings silently (no toast notifications)
 * await saveByForm({ theme: 'dark' }, true)
 * ```
 */
export const useSettings = () => {
  const settings = useSelector((state) => state.settings)

  /**
   * Saves a settings patch from the form with optional toast notifications.
   *
   * Attempts to save via `updateSettings` (a field patch — issue #563: only
   * the changed fields are sent, so a parallel app instance's saves are never
   * overwritten). On success, displays a success toast (unless silent mode is
   * enabled). On failure, parses backend error codes and displays localized
   * error messages (e.g., 'ERR:SETTINGS_PATH_NOT_DIRECTORY').
   *
   * @param patch - The settings fields to change
   * @param silent - If true, suppresses toast notifications for both
   *   success and error cases. Errors are still logged to console.
   */
  const saveByForm = async (
    patch: SettingsPatch,
    silent = false,
  ): Promise<void> => {
    try {
      await updateSettings(patch)
      if (!silent) {
        toast.success(staticT('settings.save_success', 'Settings saved'))
      }
    } catch (e) {
      const raw = String(e)
      logger.error('Failed to save settings', e)
      // Prefer single-colon format returned by settings.rs
      //   ERR:SETTINGS_PATH_NOT_DIRECTORY
      //   ERR:SETTINGS_PATH_NOT_EXIST
      // Keep double-colon format for backward compatibility
      let messageKey: string | null = null
      if (raw.includes('ERR:SETTINGS_PATH_NOT_DIRECTORY'))
        messageKey = 'settings.path_not_directory'
      else if (raw.includes('ERR:SETTINGS_PATH_NOT_EXIST'))
        messageKey = 'settings.path_not_exist'
      else if (raw.includes('ERR:SETTINGS_PATH_NOT_SET'))
        messageKey = 'settings.path_not_set'
      else if (raw.includes('ERR:SETTINGS_PATCH_INVALID'))
        messageKey = 'settings.patch_invalid'
      else if (raw.includes('ERR::SAVE_FAILED'))
        messageKey = 'settings.save_failed'
      else if (raw.includes('ERR::PERMISSION'))
        messageKey = 'settings.permission_denied'
      else if (raw.includes('ERR::DISK_FULL')) messageKey = 'settings.disk_full'

      const description = messageKey ? staticT(messageKey) : raw
      if (!silent) {
        toast.error(t('settings.save_failed_generic'), {
          duration: 10000,
          description,
        })
      }
    }
  }

  /**
   * Updates the settings dialog open/close state.
   *
   * @param open - True to open the dialog, false to close
   */
  const updateOpenDialog = (open: boolean) => {
    store.dispatch(setOpenDialog(open))
  }

  /**
   * Changes the application language and persists the setting.
   *
   * First applies the language change via i18n, then saves just the
   * `language` field as a patch.
   *
   * @param lang - The target language code
   */
  const updateLanguage = async (lang: SupportedLang) => {
    await changeLanguage(lang)
    await updateSettings({ language: lang })
  }

  /**
   * Applies and persists a partial settings update (issue #563).
   *
   * First merges the patch into the Redux store (the slice reducer shallow-
   * merges, so untouched fields keep their state values), then sends only the
   * patched fields to the backend, which merges them into the latest on-disk
   * settings under the inter-process lock. If the backend save fails, the
   * Redux state remains updated but persistence fails.
   *
   * @param patch - The settings fields to change
   * @returns True if settings were successfully saved, false otherwise
   * @throws Error if backend save operation fails
   */
  const updateSettings = async (patch: SettingsPatch): Promise<boolean> => {
    let isSuccessful = false

    try {
      store.dispatch(setSettings(patch))
      await callPatchSettings(patch)
      isSuccessful = true
    } catch (e) {
      isSuccessful = false
      throw Error(String(e))
    }

    return isSuccessful
  }

  /**
   * Updates the library storage path and moves ffmpeg to the new location.
   *
   * Calls the backend to move ffmpeg from the old path to the new path
   * with validation. On success, updates settings with the new lib_path.
   * On failure, displays an error toast (original lib_path is preserved).
   *
   * @param newPath - New library path (used as-is)
   */
  const updateLibPath = async (newPath: string): Promise<void> => {
    try {
      await callUpdateLibPath(newPath)
      // Refresh settings to get the updated lib_path
      await getSettings()
      toast.success(staticT('settings.lib_path_change_success'))
    } catch (e) {
      const raw = String(e)
      toast.error(staticT('settings.lib_path_change_error'), {
        duration: 10000,
        description: raw,
      })
    }
  }

  /**
   * Fetches settings from the backend and updates Redux store.
   *
   * @returns The fetched settings object
   */
  // Why useCallback: SettingsDialog's open-refresh effect depends on this
  // reference; an unstable one would re-run the fetch on every render.
  const getSettings = useCallback(async (): Promise<Settings> => {
    const settings = await callGetSettings()
    store.dispatch(setSettings(settings))

    return settings
  }, [])

  /**
   * Converts a language ID to its display label.
   *
   * @param id - The language code (e.g., 'en', 'ja')
   * @returns The localized language label (e.g., 'English', '日本語')
   *
   * @example
   * ```typescript
   * id2Label('ja') // '日本語'
   * id2Label('en') // 'English'
   * ```
   */
  const id2Label = (id: SupportedLang) => {
    const lang = languages.find((lang) => lang.id === id)

    return lang ? lang.label : id
  }

  return {
    settings,
    saveByForm,
    updateLanguage,
    updateOpenDialog,
    updateSettings,
    getSettings,
    updateLibPath,
    id2Label,
  }
}
