import type { FontSizePreset } from '@/features/settings/type'

/**
 * Default font size in pixels.
 *
 * Slightly smaller than the browser default (16px) to fit more
 * content on screen while remaining readable.
 */
export const FONT_SIZE_DEFAULT: FontSizePreset = 14

/**
 * Minimum allowed font size in pixels.
 */
export const FONT_SIZE_MIN = 12

/**
 * Maximum allowed font size in pixels.
 */
export const FONT_SIZE_MAX = 20

/**
 * Apply the given font size to the document root element.
 *
 * Sets `font-size` on `<html>` so that all rem-based utilities
 * (e.g. Tailwind) scale proportionally.
 *
 * @param fontSize - The font size preset to apply, in pixels.
 */
export function applyFontSize(fontSize: FontSizePreset): void {
  document.documentElement.style.fontSize = `${fontSize}px`
}

/**
 * Parse and sanitize an unknown value into a valid font size preset.
 *
 * Returns the default font size when the value is not a number.
 * Otherwise rounds the value to the nearest integer and clamps it
 * within the allowed range (`FONT_SIZE_MIN` to `FONT_SIZE_MAX`).
 *
 * @param value - Raw value to parse (e.g. from persisted settings).
 * @returns A valid `FontSizePreset` within the allowed range.
 */
export function parseFontSize(value: unknown): FontSizePreset {
  if (typeof value !== 'number') return FONT_SIZE_DEFAULT
  const clamped = Math.min(
    FONT_SIZE_MAX,
    Math.max(FONT_SIZE_MIN, Math.round(value)),
  )
  return clamped as FontSizePreset
}
