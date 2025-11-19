import { getOs } from '@/shared/os/api/getOs'
import type { TFunction } from 'i18next'
import z from 'zod'

// Lazy initialized invalid filename regex based on OS
let invalidCharsPattern: RegExp = /[\\/:*?"<>|]/ // default (Windows superset)
let initialized = false

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

// Synchronous accessor fallback; pattern may refine later but schema creation needs a regex now.
const getPatternSync = () => invalidCharsPattern

// Kick off async initialization (fire & forget)
initInvalidPattern().catch(() => {})

/**
 * 動画フォーム (Step1) 用スキーマ (URL 入力) - 多言語対応
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
 * 動画フォーム (Step2) 用スキーマ (タイトル / 画質) - 多言語対応
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

// フォールバック t (settings の実装と同様) - キーそのまま or defaultValue
const fallbackT: TFunction = ((key: unknown, defaultValue?: unknown) =>
  typeof defaultValue === 'string' ? defaultValue : String(key)) as TFunction

// 既存の import 互換: 直に schema を import している箇所への後方互換
export const formSchema1 = buildVideoFormSchema1(fallbackT)
export const formSchema2 = buildVideoFormSchema2(fallbackT)
