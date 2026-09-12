import type { TFunction } from 'i18next'

/**
 * Collects validation issues for a file system path.
 *
 * Performs the same checks the former settings-form schema enforced:
 * - Control character rejection (0x00-0x1F)
 * - Windows-specific: invalid chars, reserved names, colon placement
 * - Trailing space/dot detection
 *
 * @param value - The path string to validate
 * @param t - Translation function for localized error messages
 * @returns All localized issue messages, empty when the path is valid
 */
function collectPathIssues(value: string, t: TFunction): string[] {
  const issues: string[] = []

  // Reject control characters (0x00-0x1F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F]/.test(value)) {
    issues.push(t('validation.path.control_chars'))
  }

  const endsWithSpaceOrDot = /[ .]$/.test(value)
  const isWindowsStyle = /^[A-Za-z]:|\\\\|\\/.test(value)
  const isPosixStyle = value.startsWith('/')

  if (isWindowsStyle) {
    collectWindowsPathIssues(value, t, endsWithSpaceOrDot, issues)
  } else if (!isPosixStyle && /[<>"|?*]/.test(value)) {
    // Unknown path style - check for invalid chars. (POSIX paths need no
    // extra check: a NUL byte is already caught by the control-char rule
    // above.)
    issues.push(t('validation.path.invalid_chars'))
  }

  return issues
}

/**
 * Collects Windows-specific path issues.
 *
 * Checks for:
 * - Invalid colon placement (only allowed after drive letter)
 * - Invalid characters (< > " | ? *)
 * - Segment trailing space/dot (e.g., "folder ")
 * - Path trailing space/dot
 * - Reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 *
 * @param value - The Windows path string to validate
 * @param t - Translation function for localized error messages
 * @param endsWithSpaceOrDot - Whether the path ends with space or dot
 * @param issues - Output list the messages are appended to
 */
function collectWindowsPathIssues(
  value: string,
  t: TFunction,
  endsWithSpaceOrDot: boolean,
  issues: string[],
) {
  // Colons only allowed at position 1 (drive letter)
  const invalidColonIndex = [...value].findIndex((c, i) => c === ':' && i !== 1)
  if (invalidColonIndex !== -1) {
    issues.push(t('validation.path.windows.colon'))
  }

  // Invalid Windows characters
  if (/[<>"|?*]/.test(value)) {
    issues.push(t('validation.path.windows.invalid_chars'))
  }

  // Segment trailing space/dot check
  const segments = value.split(/\\+/)
  const hasInvalidSegment = segments.some(
    (seg) => seg !== '' && /[ .]$/.test(seg),
  )
  if (hasInvalidSegment) {
    issues.push(t('validation.path.windows.segment_trailing'))
  }

  // Path trailing space/dot check
  if (endsWithSpaceOrDot) {
    issues.push(t('validation.path.windows.path_trailing'))
  }

  // Reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
  if (segments.some((seg) => reserved.test(seg))) {
    issues.push(t('validation.path.windows.reserved'))
  }
}

/**
 * Validates the download output path and returns the first localized error.
 *
 * Replaces the former react-hook-form schema: the path is chosen via a
 * native directory picker (never typed), so a one-shot validator is enough.
 *
 * @param value - The path string to validate
 * @param t - Translation function for localized error messages
 * @returns The first localized validation message, or `null` when valid
 */
export function validateOutputPath(value: string, t: TFunction): string | null {
  if (value.length === 0) {
    return t('validation.path.required')
  }
  if (value.length > 1024) {
    return t('validation.path.too_long')
  }
  return collectPathIssues(value, t)[0] ?? null
}
