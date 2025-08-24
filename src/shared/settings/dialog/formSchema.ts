import z from 'zod'

export const formSchema = z.object({
  dlOutputPath: z
    .string()
    .min(1, { message: '出力先パスを入力してください。' })
    .max(1024, { message: 'パスは1024文字以内で入力してください。' })
    .superRefine((value, ctx) => {
      // 共通: 制御文字 (0x00-0x1F) は不可
      // eslint-disable-next-line no-control-regex -- 明示的に制御文字範囲を検出
      if (/[\x00-\x1F]/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '制御文字を含むパスは使用できません。',
        })
        return
      }

      // 末尾の空白はトリムせずに検証 (Windows で不可)
      const endsWithSpaceOrDot = /[ .]$/.test(value)

      const isWindowsStyle =
        /^[A-Za-z]:\\/.test(value) ||
        value.startsWith('\\\\') ||
        value.includes('\\')
      const isPosixStyle = value.startsWith('/')

      // Windows 用バリデーション
      if (isWindowsStyle) {
        // ドライブレターの位置以外のコロン禁止
        const colonIndexes = [...value]
          .map((c, i) => (c === ':' ? i : -1))
          .filter((i) => i !== -1)
        if (colonIndexes.some((i) => i !== 1)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Windows のパスではコロンはドライブレターの直後のみ使用できます (例: C:\\Downloads)。',
          })
        }
        // 禁止文字 (パス区切りは除く)
        const invalidChars = /[<>"|?*]/
        if (invalidChars.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Windows のパスに使用できない文字が含まれています: < > " | ? *',
          })
        }
        // 各セグメント末尾の空白やドット禁止
        const segments = value.split(/\\+/)
        if (segments.some((seg) => seg !== '' && /[ .]$/.test(seg))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Windows の各フォルダー名は末尾にスペースまたはドットを付けられません。',
          })
        }
        if (endsWithSpaceOrDot) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Windows のパスは末尾にスペースまたはドットを付けられません。',
          })
        }
        // 予約名 (CON, PRN, AUX, NUL, COM1.., LPT1..)
        const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
        if (segments.some((seg) => reserved.test(seg))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Windows の予約デバイス名 (CON, PRN, AUX, NUL, COM1.., LPT1..) は使用できません。',
          })
        }
      }

      // POSIX (macOS) 用バリデーション
      if (isPosixStyle) {
        // macOS では null と '/' を含む名前は不可 (既に含められない), '\n' など制御文字は上で除外
        // 追加で \0 は上で除外済
        if (value.includes('\0')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '無効なパスです。',
          })
        }
      }

      // どちらでもない (相対パス) の場合も最低限 Windows 禁止文字を除外
      if (!isWindowsStyle && !isPosixStyle) {
        if (/[<>"|?*]/.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'パスに使用できない文字が含まれています: < > " | ? *',
          })
        }
      }
    }),
})
