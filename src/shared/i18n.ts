import {
  changeLanguage as i18nChangeLanguage,
  type SupportedLang,
} from '@/i18n'

// BE(settings.json) を単一の永続ソースとし、localStorage は利用しない
export function changeLanguage(lang: SupportedLang) {
  return i18nChangeLanguage(lang)
}
