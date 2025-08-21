import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ja from './locales/ja.json'

export type SupportedLang = 'en' | 'ja'

// Resolve preferred language from localStorage or the browser/OS; default to 'en'
const DEFAULT_LANG = ((): SupportedLang => {
  try {
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null
    if (stored === 'en' || stored === 'ja') return stored
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
  return 'en'
})()

export function setupI18n(initialLang?: SupportedLang) {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ja: { translation: ja },
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
  if (lng === 'en' || lng === 'ja') return lng
  return DEFAULT_LANG
}

export default i18n
