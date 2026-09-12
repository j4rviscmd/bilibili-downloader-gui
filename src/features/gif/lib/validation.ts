/**
 * Pure-function helpers for GIF/WebM timecode parsing and range validation.
 *
 * Kept free of React/i18n so they can be unit-tested in isolation.
 * Translation of error keys to user-facing strings happens at the call site.
 */

/**
 * Regex for `hh:mm:ss` with optional fractional seconds.
 *
 * - hours: 1-2 digits, any value (videos can exceed 1h)
 * - minutes: exactly 2 digits, 00-59
 * - seconds: exactly 2 digits, 00-59, optionally followed by `.ddd`
 */
const TIMECODE_REGEX = /^(\d{1,2}):([0-5]\d):([0-5]\d)(\.\d+)?$/

/**
 * Parses a timecode string into seconds.
 *
 * @param input - User input string (whitespace is trimmed)
 * @returns Seconds (with fractional part preserved), or `null` if the input
 *   is empty or does not match the expected format
 */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const match = trimmed.match(TIMECODE_REGEX)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const s = parseFloat(match[3] + (match[4] ?? ''))
  return h * 3600 + m * 60 + s
}

/**
 * Discriminated error keys for {@link validateGifRange}.
 *
 * The string values are suffixed onto `gif.error.` to form i18n keys.
 */
export type GifRangeError =
  | 'invalid_start'
  | 'invalid_end'
  | 'end_before_start'
  | 'empty_start'
  | 'empty_end'

/**
 * Validates a start/end timecode pair. Both bounds are required — the
 * feature always generates a bounded clip, so "to the end" is not offered.
 *
 * @returns An error key from {@link GifRangeError}, or `null` if valid
 */
export function validateGifRange(
  start: string,
  end: string,
): GifRangeError | null {
  const startSec = parseTimecode(start)
  const endSec = parseTimecode(end)

  // Distinguish "empty" from "malformed" so the hint can tell the user
  // which field needs attention.
  if (startSec === null)
    return start.trim() === '' ? 'empty_start' : 'invalid_start'
  if (endSec === null) return end.trim() === '' ? 'empty_end' : 'invalid_end'
  if (startSec >= endSec) return 'end_before_start'
  return null
}
