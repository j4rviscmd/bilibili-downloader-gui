import {
  changeLanguage as i18nChangeLanguage,
  type SupportedLang,
} from '@/i18n'

export function changeLanguage(lang: SupportedLang) {
  return i18nChangeLanguage(lang)
}
