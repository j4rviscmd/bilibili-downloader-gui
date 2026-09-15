import type { SupportedLang } from '@/shared/i18n'

export const setupLanguages = [
  ['en', 'English'],
  ['zh', '简体中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['fr', 'Français'],
] as const

export function detectSetupLanguage(locales: readonly string[]): SupportedLang {
  for (const locale of locales) {
    const code = locale.toLowerCase().split(/[-_]/)[0]
    if (setupLanguages.some(([id]) => id === code)) return code as SupportedLang
  }
  return 'en'
}
