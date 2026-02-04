import {
  changeLanguage as i18nChangeLanguage,
  type SupportedLang,
} from '@/i18n'

export type { SupportedLang }

/**
 * Changes the application language.
 *
 * Wrapper around the i18n changeLanguage function. The language is persisted
 * to the backend (settings.json) as the single source of truth. localStorage
 * is not used for language persistence.
 *
 * @param lang - The target language code
 * @returns A promise that resolves when the language change completes
 *
 * @example
 * ```typescript
 * await changeLanguage('ja') // Switch to Japanese
 * ```
 */
export function changeLanguage(lang: SupportedLang) {
  return i18nChangeLanguage(lang)
}
