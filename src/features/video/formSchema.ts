import type { TFunction } from 'i18next'
import z from 'zod'

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
      .refine((val) => !/[\\/:*?"<>|]/.test(val), {
        message: t('validation.video.title.invalid_chars'),
      }),
    quality: z
      .string()
      .nonempty({ message: t('validation.video.quality.required') }),
  })

// フォールバック t (settings の実装と同様) - キーそのまま or defaultValue
const fallbackT: TFunction = ((key: unknown, defaultValue?: unknown) =>
  typeof defaultValue === 'string' ? defaultValue : String(key)) as TFunction

// 既存の import 互換: 直に schema を import している箇所への後方互換
export const formSchema1 = buildVideoFormSchema1(fallbackT)
export const formSchema2 = buildVideoFormSchema2(fallbackT)
