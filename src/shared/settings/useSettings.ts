import { store, useSelector } from '@/app/store'
import type { SupportedLang } from '@/i18n'
import { changeLanguage } from '@/shared/i18n'
import {
  callGetSettings,
  callSetSettings,
} from '@/shared/settings/api/settingApi'
import { languages } from '@/shared/settings/language/languages'
import { setOpenDialog, setSettings } from '@/shared/settings/settingsSlice'
import type { Settings } from '@/shared/settings/type'

export const useSettings = () => {
  const settings = useSelector((state) => state.settings)

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
  const updateSettings = async (newSettings: Settings): Promise<void> => {
    store.dispatch(setSettings(newSettings))
    await callSetSettings(newSettings)

    return
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
    updateLanguage,
    updateOpenDialog,
    getSettings,
    id2Label,
  }
}
