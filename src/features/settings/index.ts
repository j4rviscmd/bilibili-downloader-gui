/**
 * Public API for the settings feature.
 *
 * Manages application settings including language preferences,
 * theme selection, and persistent storage via Tauri backend.
 * @module features/settings
 */

export {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  applyFontSize,
  parseFontSize,
} from '@/features/settings/lib/fontSize'
export * from '@/features/settings/settingsSlice'
export * from '@/features/settings/type'
