/**
 * Public API for the settings feature.
 *
 * Manages application settings including language preferences,
 * theme selection, and persistent storage via Tauri backend.
 * @module features/settings
 */

export { languages } from '@/features/settings/language/languages'
export {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  applyFontSize,
  parseFontSize,
} from '@/features/settings/lib/fontSize'
export * from '@/features/settings/settingsSlice'
export * from '@/features/settings/type'
export { useSettings } from '@/features/settings/useSettings'
