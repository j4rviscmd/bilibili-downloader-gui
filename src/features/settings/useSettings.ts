import { store, useSelector } from '@/app/store'
import {
  callGetSettings,
  callSetSettings,
} from '@/features/settings/api/settingApi'
import { languages } from '@/features/settings/language/languages'
import { setOpenDialog, setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import type { SupportedLang } from '@/i18n'
import { changeLanguage } from '@/shared/i18n'
import { t as staticT, t } from 'i18next'
import { toast } from 'sonner'

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
 * ```
 */
export const useSettings = () => {
  const settings = useSelector((state) => state.settings)

  /**
   * Saves settings from the form with toast notifications.
   *
   * Attempts to save settings via `updateSettings`. On success, displays
   * a success toast. On failure, parses backend error codes and displays
   * localized error messages (e.g., 'ERR:SETTINGS_PATH_NOT_DIRECTORY').
   *
   * @param settings - The settings object to save
   */
  const saveByForm = async (settings: Settings): Promise<void> => {
    try {
      const isSuccessful = await updateSettings(settings)
      if (isSuccessful) {
        toast.success(staticT('settings.save_success', 'Settings saved'))
        return
      }
    } catch (e) {
      const raw = String(e)
      // settings.rs で返されるコード (シングルコロン形式) を優先判定
      //   ERR:SETTINGS_PATH_NOT_DIRECTORY
      //   ERR:SETTINGS_PATH_NOT_EXIST
      // 既存のダブルコロン形式 (将来互換) も一応残す
      let messageKey: string | null = null
      if (raw.includes('ERR:SETTINGS_PATH_NOT_DIRECTORY'))
        messageKey = 'settings.path_not_directory'
      else if (raw.includes('ERR:SETTINGS_PATH_NOT_EXIST'))
        messageKey = 'settings.path_not_exist'
      else if (raw.includes('ERR::SAVE_FAILED'))
        messageKey = 'settings.save_failed'
      else if (raw.includes('ERR::PERMISSION'))
        messageKey = 'settings.permission_denied'
      else if (raw.includes('ERR::DISK_FULL')) messageKey = 'settings.disk_full'

      const description = messageKey ? staticT(messageKey) : raw
      toast.error(t('settings.save_failed_generic'), {
        duration: 10000,
        description,
        closeButton: true,
      })
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
   * First applies the language change via i18n, then saves the updated
   * settings to the backend.
   *
   * @param lang - The target language code
   */
  const updateLanguage = async (lang: SupportedLang) => {
    await changeLanguage(lang)
    await updateSettings({ ...settings, language: lang })
  }

  /**
   * Updates and persists application settings.
   *
   * First updates the Redux store, then saves to the Tauri backend.
   * If the backend save fails, the Redux state remains updated but
   * persistence fails.
   *
   * @param newSettings - The new settings object
   * @returns True if settings were successfully saved, false otherwise
   * @throws Error if backend save operation fails
   */
  const updateSettings = async (newSettings: Settings): Promise<boolean> => {
    let isSuccessful = false

    try {
      store.dispatch(setSettings(newSettings))
      await callSetSettings(newSettings)
      isSuccessful = true
    } catch (e) {
      isSuccessful = false
      throw Error(String(e))
    }

    return isSuccessful
  }

  /**
   * Fetches settings from the backend and updates Redux store.
   *
   * @returns The fetched settings object
   */
  const getSettings = async (): Promise<Settings> => {
    const settings = await callGetSettings()
    store.dispatch(setSettings(settings))

    return settings
  }

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
    id2Label,
  }
}
