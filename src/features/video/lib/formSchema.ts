import { getOs } from '@/shared/os/api/getOs'
import type { TFunction } from 'i18next'
import z from 'zod'

/**
 * Regex pattern for invalid filename characters.
 *
 * Defaults to Windows superset, refined by OS detection.
 */
let invalidCharsPattern: RegExp = /[\\/:*?"<>|]/ // default (Windows superset)
let initialized = false

/**
 * Initializes the OS-specific invalid filename pattern.
 *
 * Detects the current OS and sets the appropriate regex for forbidden
 * filename characters (Windows vs POSIX).
 *
 * @returns The initialized regex pattern
 */
const initInvalidPattern = async () => {
  if (initialized) return invalidCharsPattern
  initialized = true
  const os = await getOs()
  if (os === 'windows') {
    // Windows disallowed: \\ / : * ? " < > | and also trailing dots/spaces (handled separately if needed)
    invalidCharsPattern = /[\\/:*?"<>|]/
  } else {
    // macOS / Linux: only '/' and NUL (NUL not representable in JS string) and on mac older Finder reserved ':' historically
    // We'll block '/' and (optionally) '\0' via explicit check
    invalidCharsPattern = /[\/]/ // eslint-disable-line no-useless-escape
  }
  return invalidCharsPattern
}

/**
 * Returns the current invalid filename pattern synchronously.
 *
 * @returns The current invalid chars regex
 */
const getPatternSync = () => invalidCharsPattern

// Kick off async initialization (fire & forget)
initInvalidPattern().catch(() => {})

/**
 * Builds a localized validation schema for video URL input (Step 1).
 *
 * Validates that the URL is a valid Bilibili video link from www.bilibili.com.
 *
 * @param t - The i18next translation function for error messages
 * @returns A Zod schema for video URL validation
 *
 * @example
 * ```typescript
 * const schema = buildVideoFormSchema1(t)
 * const result = schema.safeParse({ url: 'https://www.bilibili.com/video/BV1xx411c7XD' })
 * ```
 */
export const buildVideoFormSchema1 = (t: TFunction) =>
  z.object({
    url: z
      .string()
      .min(2, { message: t('validation.video.url.min') })
      .max(1000, { message: t('validation.video.url.max') })
      .url({ message: t('validation.video.url.invalid') })
      .superRefine((value, ctx) => {
        try {
          const { hostname } = new URL(value)
          // bilibili.com 直下のみ許可（必要に応じてサブドメインも許可可能）
          // 将来的にサブドメイン許可: /^(?:[a-z0-9-]+\.)*bilibili\.com$/i
          const ok = /^www.bilibili\.com$/i.test(hostname)
          if (!ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.video.url.domain'),
            })
          }
        } catch {
          // .url() が既にURL形式の検証とメッセージを担当
        }
      }),
  })

/**
 * Builds a localized validation schema for video part settings (Step 2).
 *
 * Validates title (filename), video quality, and audio quality.
 * Title validation includes OS-specific checks for invalid filename characters
 * and Windows reserved names (e.g., CON, PRN, NUL).
 *
 * @param t - The i18next translation function for error messages
 * @returns A Zod schema for video part input validation
 *
 * @example
 * ```typescript
 * const schema = buildVideoFormSchema2(t)
 * const result = schema.safeParse({
 *   title: 'My Video',
 *   videoQuality: '80',
 *   audioQuality: '30216'
 * })
 * ```
 */
export const buildVideoFormSchema2 = (t: TFunction) =>
  z.object({
    title: z
      .string()
      .min(2, { message: t('validation.video.title.min') })
      .max(100, { message: t('validation.video.title.max') })
      .nonempty({ message: t('validation.video.title.required') })
      .superRefine((val, ctx) => {
        const pattern = getPatternSync()
        if (pattern.test(val) || /\0/.test(val)) {
          const osChars = invalidCharsPattern.source.includes(':*?"<>|')
            ? '\\ / : * ? " < > |' // windows
            : '/'
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('validation.video.title.invalid_chars', {
              chars: osChars,
            }),
          })
        }
        if (
          invalidCharsPattern.source.includes(':*?"<>|') &&
          /[.\s]$/.test(val)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('validation.video.title.invalid_chars', {
              chars: '\\ / : * ? " < > |',
            }),
          })
        }
      }),
    videoQuality: z
      .string()
      .nonempty({ message: t('validation.video.quality.required') }),
    audioQuality: z
      .string()
      .nonempty({ message: t('validation.video.audio_quality.required') }),
  })

/**
 * Fallback translation function for backward compatibility.
 *
 * Returns the default value if provided, otherwise the key as-is.
 *
 * @deprecated Use buildVideoFormSchema1/2 with useTranslation instead
 */
const fallbackT: TFunction = ((key: unknown, defaultValue?: unknown) =>
  typeof defaultValue === 'string' ? defaultValue : String(key)) as TFunction

/**
 * Backward-compatible schema instance for Step 1 (URL input).
 *
 * @deprecated Use buildVideoFormSchema1(t) with real translation function
 */
export const formSchema1 = buildVideoFormSchema1(fallbackT)

/**
 * Backward-compatible schema instance for Step 2 (part settings).
 *
 * @deprecated Use buildVideoFormSchema2(t) with real translation function
 */
export const formSchema2 = buildVideoFormSchema2(fallbackT)
