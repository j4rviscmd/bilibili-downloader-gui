/**
 * Pure-function helpers for trim timecode parsing and range validation.
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
 * Discriminated error keys for {@link validateTrimRange}.
 *
 * The string values are suffixed onto `trim.error.` to form i18n keys.
 */
export type TrimRangeError =
  | 'invalid_start'
  | 'invalid_end'
  | 'end_before_start'
  | 'both_empty'

/**
 * Validates a start/end timecode pair.
 *
 * Empty start means "from the beginning"; empty end means "to the end".
 * Both empty is rejected — at least one bound is required.
 *
 * @returns An error key from {@link TrimRangeError}, or `null` if valid
 */
export function validateTrimRange(
  start: string,
  end: string,
): TrimRangeError | null {
  const startEmpty = start.trim() === ''
  const endEmpty = end.trim() === ''
  if (startEmpty && endEmpty) return 'both_empty'

  const startSec = parseTimecode(start)
  const endSec = parseTimecode(end)

  if (!startEmpty && startSec === null) return 'invalid_start'
  if (!endEmpty && endSec === null) return 'invalid_end'
  if (startSec !== null && endSec !== null && startSec >= endSec) {
    return 'end_before_start'
  }
  return null
}
