import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

export type SupportedLang = 'en' | 'ja' | 'fr' | 'es' | 'zh' | 'ko'

// Resolve preferred language from localStorage or the browser/OS; default to 'en'
const DEFAULT_LANG = ((): SupportedLang => {
  try {
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null
    if (['en', 'ja', 'fr', 'es', 'zh', 'ko'].includes(stored || ''))
      return stored as SupportedLang
  } catch {
    // ignore storage errors
  }
  if (typeof navigator === 'undefined') return 'en'
  const lang = (
    navigator.language ||
    navigator.languages?.[0] ||
    'en'
  ).toLowerCase()
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('es')) return 'es'
  if (lang.startsWith('zh')) return 'zh'
  if (lang.startsWith('ko')) return 'ko'
  return 'en'
})()

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
      lng: initialLang ?? DEFAULT_LANG,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    })
  } else if (initialLang) {
    i18n.changeLanguage(initialLang)
  }
  return i18n
}

export function changeLanguage(lang: SupportedLang) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('lang', lang)
  } catch {
    // ignore storage errors
  }
  return i18n.changeLanguage(lang)
}

export function getCurrentLanguage(): SupportedLang {
  const lng = i18n.language as SupportedLang | undefined
  if (['en', 'ja', 'fr', 'es', 'zh', 'ko'].includes(lng || ''))
    return lng as SupportedLang
  return DEFAULT_LANG
}

export default i18n
