import type { TFunction } from 'i18next'
import z from 'zod'

/**
 * Adds a validation issue to the context.
 */
const addIssue = (ctx: z.RefinementCtx, message: string) => {
  ctx.addIssue({ code: 'custom', message })
}

/**
 * Validates a file system path for OS-specific constraints.
 *
 * Performs comprehensive validation including:
 * - Control character rejection (0x00-0x1F)
 * - Windows-specific: invalid chars, reserved names, colon placement
 * - POSIX-specific: null byte check
 * - Trailing space/dot detection
 */
function refinePath(value: string, ctx: z.RefinementCtx, t: TFunction) {
  // Reject control characters (0x00-0x1F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F]/.test(value)) {
    return addIssue(ctx, t('validation.path.control_chars'))
  }

  const endsWithSpaceOrDot = /[ .]$/.test(value)
  const isWindowsStyle = /^[A-Za-z]:|\\\\|\\/.test(value)
  const isPosixStyle = value.startsWith('/')

  if (isWindowsStyle) {
    validateWindowsPath(value, ctx, t, endsWithSpaceOrDot)
  } else if (isPosixStyle && value.includes('\0')) {
    addIssue(ctx, t('validation.path.invalid'))
  } else if (/[<>"|?*]/.test(value)) {
    // Unknown path style - check for invalid chars
    addIssue(ctx, t('validation.path.invalid_chars'))
  }
}

/**
 * Validates Windows-specific path constraints.
 */
function validateWindowsPath(
  value: string,
  ctx: z.RefinementCtx,
  t: TFunction,
  endsWithSpaceOrDot: boolean,
) {
  // Colons only allowed at position 1 (drive letter)
  const invalidColonIndex = [...value].findIndex((c, i) => c === ':' && i !== 1)
  if (invalidColonIndex !== -1) {
    addIssue(ctx, t('validation.path.windows.colon'))
  }

  // Invalid Windows characters
  if (/[<>"|?*]/.test(value)) {
    addIssue(ctx, t('validation.path.windows.invalid_chars'))
  }

  // Segment trailing space/dot check
  const segments = value.split(/\\+/)
  const hasInvalidSegment = segments.some(
    (seg) => seg !== '' && /[ .]$/.test(seg),
  )
  if (hasInvalidSegment) {
    addIssue(ctx, t('validation.path.windows.segment_trailing'))
  }

  // Path trailing space/dot check
  if (endsWithSpaceOrDot) {
    addIssue(ctx, t('validation.path.windows.path_trailing'))
  }

  // Reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
  if (segments.some((seg) => reserved.test(seg))) {
    addIssue(ctx, t('validation.path.windows.reserved'))
  }
}

/**
 * Builds a localized validation schema for the settings form.
 *
 * Creates a Zod schema with validation rules for download output path and
 * language selection. Path validation includes:
 * - Length constraints (1-1024 characters)
 * - OS-specific invalid character checks (Windows vs POSIX)
 * - Reserved filename detection (Windows only)
 * - Control character detection
 *
 * @param t - The i18next translation function for localized error messages
 * @returns A Zod schema for settings form validation
 *
 * @example
 * ```typescript
 * const schema = buildSettingsFormSchema(t)
 * const result = schema.safeParse({ dlOutputPath: '/downloads', language: 'en' })
 * ```
 */
export const buildSettingsFormSchema = (t: TFunction) =>
  z.object({
    dlOutputPath: z
      .string()
      .min(1, {
        message: t('validation.path.required'),
      })
      .max(1024, {
        message: t('validation.path.too_long'),
      })
      .superRefine((value, ctx) => refinePath(value, ctx, t)),
    language: z.enum(['en', 'ja', 'fr', 'es', 'zh', 'ko'] as const, {
      message: t('validation.language.required'),
    }),
    libPath: z
      .string()
      .max(1024, {
        message: t('validation.path.too_long'),
      })
      .superRefine((value, ctx) => refinePath(value, ctx, t))
      .optional(),
  })

/**
 * Fallback schema for backward compatibility.
 *
 * Uses a minimal translation function that returns the key as-is when no
 * translation is available. Prefer using `buildSettingsFormSchema(t)` with
 * a real translation function when possible.
 *
 * @deprecated Use buildSettingsFormSchema with useTranslation hook instead
 */
const fallbackT: TFunction = ((key: unknown, defaultValue?: unknown) =>
  typeof defaultValue === 'string' ? defaultValue : String(key)) as TFunction
export const formSchema = buildSettingsFormSchema(fallbackT)
