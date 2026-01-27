import { store, useSelector } from '@/app/store'
import type { SupportedLang } from '@/i18n'
import { changeLanguage } from '@/shared/i18n'
import {
  callGetSettings,
  callSetSettings,
} from '@/features/settings/api/settingApi'
import { languages } from '@/features/settings/language/languages'
import { setOpenDialog, setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { t as staticT, t } from 'i18next'
import { toast } from 'sonner'

export const useSettings = () => {
  const settings = useSelector((state) => state.settings)

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

      console.log(messageKey)
      const description = messageKey ? staticT(messageKey) : raw
      console.log(messageKey)
      console.log(t(messageKey ?? ''))
      toast.error(t('settings.save_failed_generic'), {
        duration: 10000,
        description,
        closeButton: true,
      })
      console.error('Save settings failed:', raw)
    }
  }

  const updateOpenDialog = (open: boolean) => {
    store.dispatch(setOpenDialog(open))
  }

  const updateLanguage = async (lang: SupportedLang) => {
    await changeLanguage(lang)
    await updateSettings({ ...settings, language: lang })
  }

  /**
   * アプリ全体の設定を更新します。まず Redux ストアへ反映し、その後永続層（Tauri 側 API）へ保存要求を送ります。
   * @param newSettings 反映したい最新の設定オブジェクト全体。
   * @returns なし
   * @remarks
   */
  const updateSettings = async (newSettings: Settings): Promise<boolean> => {
    let isSuccessful = false

    try {
      store.dispatch(setSettings(newSettings))
      await callSetSettings(newSettings)
      isSuccessful = true
    } catch (e) {
      isSuccessful = false
      console.log(e)
      throw Error(String(e))
    }

    return isSuccessful
  }

  const getSettings = async (): Promise<Settings> => {
    const settings = await callGetSettings()
    store.dispatch(setSettings(settings))

    return settings
  }

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
