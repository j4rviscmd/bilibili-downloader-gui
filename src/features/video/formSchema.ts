import z from 'zod'

export const formSchema1 = z.object({
  url: z
    .string()
    .min(2, { message: 'URLは2文字以上で入力してください。' })
    .max(1000, { message: 'URLは1000文字以内で入力してください。' })
    .url({ message: '有効なURLを入力してください。' })
    .superRefine((value, ctx) => {
      try {
        const { hostname } = new URL(value)
        // bilibili.com 直下のみ許可（必要に応じてサブドメインも許可可能）
        const ok = /^www.bilibili\.com$/i.test(hostname)
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'bilibili.com のURLのみ有効です。',
          })
        }
      } catch {
        // .url() が既にURL形式の検証とメッセージを担当
      }
    }),
})

export const formSchema2 = z.object({
  title: z
    .string()
    .min(2, { message: 'タイトルは2文字以上で入力してください。' })
    .max(100, { message: 'タイトルは100文字以内で入力してください。' })
    .nonempty({ message: 'タイトルを入力してください。' })
    .refine((val) => !/[\\/:*?"<>|]/.test(val), {
      message:
        'タイトルに使用できない文字が含まれています（\\ / : * ? " < > |）',
    }),
  quality: z.string().nonempty({ message: '画質を選択してください。' }),
})
