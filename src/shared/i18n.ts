import { changeLanguage as i18nChangeLanguage } from '@/i18n'

export type SupportedLang = 'en' | 'ja'

export function changeLanguage(lang: SupportedLang) {
  return i18nChangeLanguage(lang)
}
