import type { TFunction } from 'i18next'
import z from 'zod'

/**
 * 多言語対応版設定フォームスキーマ。
 * i18n の t 関数を受け取り、各バリデーションメッセージを現在の言語に合わせて生成します。
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
      .superRefine((value, ctx) => {
        // 制御文字 (0x00-0x1F) を拒否
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x1F]/.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('validation.path.control_chars'),
          })
          return
        }

        const endsWithSpaceOrDot = /[ .]$/.test(value)
        const isWindowsStyle =
          /^[A-Za-z]:\\/.test(value) ||
          value.startsWith('\\\\') ||
          value.includes('\\')
        const isPosixStyle = value.startsWith('/')

        if (isWindowsStyle) {
          const colonIndexes = [...value]
            .map((c, i) => (c === ':' ? i : -1))
            .filter((i) => i !== -1)
          if (colonIndexes.some((i) => i !== 1)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.windows.colon'),
            })
          }
          const invalidChars = /[<>"|?*]/
          if (invalidChars.test(value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.windows.invalid_chars'),
            })
          }
          const segments = value.split(/\\+/)
          if (segments.some((seg) => seg !== '' && /[ .]$/.test(seg))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.windows.segment_trailing'),
            })
          }
          if (endsWithSpaceOrDot) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.windows.path_trailing'),
            })
          }
          const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
          if (segments.some((seg) => reserved.test(seg))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.windows.reserved'),
            })
          }
        }

        if (isPosixStyle) {
          if (value.includes('\0')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.invalid'),
            })
          }
        }

        if (!isWindowsStyle && !isPosixStyle) {
          if (/[<>"|?*]/.test(value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('validation.path.invalid_chars'),
            })
          }
        }
      }),
    language: z.enum(['en', 'ja', 'fr', 'es', 'zh', 'ko'] as const, {
      message: t('validation.language.required'),
    }),
  })

// 後方互換: t を動的に取得できないコンテキスト向け (初期ロード時に ja フォールバック)
// 使用箇所では buildSettingsFormSchema(t) の利用を推奨
// 簡易フォールバック t: 第二引数 (defaultValue) を優先し、無ければキーをそのまま返す
const fallbackT: TFunction = ((key: unknown, defaultValue?: unknown) =>
  typeof defaultValue === 'string' ? defaultValue : String(key)) as TFunction
export const formSchema = buildSettingsFormSchema(fallbackT)
