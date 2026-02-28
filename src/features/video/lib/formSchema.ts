import { getOs } from '@/shared/os/api/getOs'
import type { TFunction } from 'i18next'
import z from 'zod'

const UNSUPPORTED_HOSTNAME_RULES: Array<[RegExp, string]> = [
  [/^b23\.tv$/i, 'validation.video.url.short_url'],
  [/^space\.bilibili\.com$/i, 'validation.video.url.space'],
  [/^member\.bilibili\.com$/i, 'validation.video.url.member'],
  [/^live\.bilibili\.com$/i, 'validation.video.url.live'],
  [/^au\.bilibili\.com$/i, 'validation.video.url.audio'],
]

const UNSUPPORTED_PATHNAME_RULES: Array<[RegExp, string]> = [
  [/^\/bangumi\/media\//i, 'validation.video.url.bangumi_list'],
  [/^\/cheese\//i, 'validation.video.url.cheese'],
  [/^\/audio\//i, 'validation.video.url.audio'],
  [/^\/read\//i, 'validation.video.url.article'],
]

/**
 * Detects unsupported Bilibili URL patterns and returns a specific error key.
 *
 * This function checks for known unsupported URL patterns and returns
 * a specific translation key for better UX. Returns null if the pattern
 * is not recognized as a known unsupported type.
 *
 * @param hostname - The URL hostname (e.g., "space.bilibili.com")
 * @param pathname - The URL pathname (e.g., "/bangumi/media/md123")
 * @param t - The translation function
 * @returns A specific error message or null if not a known pattern
 */
const getUnsupportedUrlError = (
  hostname: string,
  pathname: string,
  t: TFunction,
): string | null => {
  for (const [pattern, key] of UNSUPPORTED_HOSTNAME_RULES) {
    if (pattern.test(hostname)) return t(key)
  }
  for (const [pattern, key] of UNSUPPORTED_PATHNAME_RULES) {
    if (pattern.test(pathname)) return t(key)
  }
  return null
}

/**
 * Regex pattern for invalid filename characters.
 *
 * Defaults to Windows superset, refined by OS detection.
 * Initialized asynchronously by `initInvalidPattern()`.
 */
let invalidCharsPattern: RegExp = /[\\/:*?"<>|]/ // default (Windows superset)

/**
 * Flag indicating whether OS-specific pattern initialization has occurred.
 */
let initialized = false

/**
 * Initializes the OS-specific invalid filename pattern.
 *
 * @returns The initialized regex pattern
 */
const initInvalidPattern = async () => {
  if (initialized) return invalidCharsPattern
  initialized = true
  const os = await getOs()
  if (os !== 'windows') {
    invalidCharsPattern = /\//
  }
  return invalidCharsPattern
}

/**
 * Returns the current invalid filename pattern synchronously.
 */
const getPatternSync = () => invalidCharsPattern

// Kick off async initialization
initInvalidPattern().catch(() => {})

/**
 * Builds a localized validation schema for video URL input (Step 1).
 *
 * Validates that the URL is a valid Bilibili video or bangumi link from www.bilibili.com.
 *
 * @param t - The i18next translation function for error messages
 * @returns A Zod schema for video URL validation
 *
 * @example
 * ```typescript
 * const schema = buildVideoFormSchema1(t)
 * const result = schema.safeParse({ url: 'https://www.bilibili.com/video/BV1xx411c7XD' })
 * const bangumi = schema.safeParse({ url: 'https://www.bilibili.com/bangumi/play/ep3051843' })
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
          const { hostname, pathname } = new URL(value)

          // Check for known unsupported patterns first (better UX)
          const unsupportedError = getUnsupportedUrlError(hostname, pathname, t)
          if (unsupportedError) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: unsupportedError,
            })
            return
          }

          // bilibili.com 直下のみ許可（必要に応じてサブドメインも許可可能）
          const ok = /^www\.bilibili\.com$/i.test(hostname)
          if (!ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.video.url.domain'),
            })
            return
          }
          // 動画URL または バンガミURL のパス形式をチェック
          const isVideoPath = /^\/video\/[a-zA-Z0-9]+/.test(pathname)
          const isBangumiPath = /^\/bangumi\/play\/ep\d+/.test(pathname)
          if (!isVideoPath && !isBangumiPath) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.video.url.format'),
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
 * Validates title (filename) only. Quality selection is delegated to the
 * backend's best-effort auto-selection logic.
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
 *   videoQuality: '',
 *   audioQuality: ''
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
        const isWindows = invalidCharsPattern.source.includes(':*?"<>|')
        const osChars = isWindows ? '\\ / : * ? " < > |' : '/'

        if (pattern.test(val) || /\0/.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('validation.video.title.invalid_chars', {
              chars: osChars,
            }),
          })
        }
        if (isWindows && /[.\s]$/.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('validation.video.title.invalid_chars', {
              chars: osChars,
            }),
          })
        }
      }),
    // Quality fields are optional — backend selects best available quality
    videoQuality: z.string(),
    // audioQuality can be empty for durl format (MP4) where audio is embedded
    audioQuality: z.string(),
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
