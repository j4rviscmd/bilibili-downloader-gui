import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { Input as FormType } from '@/features/video/types'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const formSchema = z.object({
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

type Props = {
  input: FormType
  onChange: (_: FormType) => void
}

function VideoForm({ input, onChange }: Props) {
  useEffect(() => {
    form.setValue('url', input.url)
  }, [])

  async function onSubmit(data: z.infer<typeof formSchema>) {
    console.log(data)
    onChange(data)

    // 動画愛情報を抽出
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: '',
    },
  })

  const placeholder = 'https://www.bilibili.com/video/BV1xxxxxx'
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onBlur={form.handleSubmit(onSubmit)}
        className="space-y-8"
      >
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>動画URL</FormLabel>
              <FormControl>
                <Input required placeholder={placeholder} {...field} />
              </FormControl>
              <FormDescription>
                BiliBili動画のURLを入力してください。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* <Button type="submit">Submit</Button> */}
      </form>
    </Form>
  )
}

export default VideoForm
