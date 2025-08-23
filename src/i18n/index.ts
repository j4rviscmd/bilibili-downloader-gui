import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'
export type SupportedLang = 'en' | 'ja' | 'fr' | 'es' | 'zh' | 'ko'

// フロント側ではブラウザ・localStorage を使わず、引数で渡された言語 or fallback
const FALLBACK_LANG: SupportedLang = 'en'

export function setupI18n(initialLang?: SupportedLang) {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ja: { translation: ja },
        fr: { translation: fr },
        es: { translation: es },
        zh: { translation: zh },
        ko: { translation: ko },
      },
      lng: initialLang ?? FALLBACK_LANG,
      fallbackLng: FALLBACK_LANG,
      interpolation: { escapeValue: false },
      returnNull: false,
    })
  } else if (initialLang) {
    i18n.changeLanguage(initialLang)
  }
  return i18n
}

export function changeLanguage(lang: SupportedLang) {
  return i18n.changeLanguage(lang)
}

export function getCurrentLanguage(): SupportedLang {
  const lng = i18n.language as string | undefined
  if (lng && ['en', 'ja', 'fr', 'es', 'zh', 'ko'].includes(lng))
    return lng as SupportedLang
  return FALLBACK_LANG
}

export default i18n
