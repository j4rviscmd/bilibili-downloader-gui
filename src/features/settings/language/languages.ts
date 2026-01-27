import type { Language } from '@/features/settings/type'

/**
 * List of supported languages with their display labels.
 *
 * Each language object contains an ID (language code) and a label
 * (localized name of the language in its native script).
 *
 * @example
 * ```typescript
 * languages.find(l => l.id === 'ja')?.label // '日本語'
 * ```
 */
export const languages: Language[] = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'zh', label: '中文' },
  { id: 'ko', label: '한국어' },
]
