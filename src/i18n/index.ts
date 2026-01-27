/**
 * i18n (internationalization) configuration module.
 *
 * Provides multi-language support for the application using i18next.
 * Supported languages: English, Japanese, French, Spanish, Chinese, Korean.
 * @module i18n
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

/**
 * Supported language codes.
 */
export type SupportedLang = 'en' | 'ja' | 'fr' | 'es' | 'zh' | 'ko'

/**
 * Default fallback language when no language is specified.
 */
const FALLBACK_LANG: SupportedLang = 'en'

/**
 * Initializes the i18n instance with translation resources.
 *
 * If i18n is not yet initialized, it configures all supported languages
 * and sets the initial language. If already initialized, it changes to
 * the specified language. Note: This does not use browser locale or
 * localStorage; language must be explicitly provided or defaults to English.
 *
 * @param initialLang - The initial language to set. Defaults to English.
 * @returns The configured i18n instance.
 *
 * @example
 * ```typescript
 * setupI18n('ja') // Initialize with Japanese
 * setupI18n()     // Initialize with English (fallback)
 * ```
 */
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

/**
 * Changes the current language dynamically.
 *
 * @param lang - The target language code.
 * @returns A promise that resolves when the language change completes.
 *
 * @example
 * ```typescript
 * await changeLanguage('fr') // Switch to French
 * ```
 */
export function changeLanguage(lang: SupportedLang) {
  return i18n.changeLanguage(lang)
}

/**
 * Gets the currently active language.
 *
 * If the current language is not one of the supported languages,
 * returns the fallback language (English).
 *
 * @returns The current language code.
 *
 * @example
 * ```typescript
 * const current = getCurrentLanguage() // 'en', 'ja', etc.
 * ```
 */
export function getCurrentLanguage(): SupportedLang {
  const lng = i18n.language as string | undefined
  if (lng && ['en', 'ja', 'fr', 'es', 'zh', 'ko'].includes(lng))
    return lng as SupportedLang
  return FALLBACK_LANG
}

export default i18n
