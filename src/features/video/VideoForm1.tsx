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
import { formSchema1 } from '@/features/video/formSchema'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

function VideoForm1() {
  const { input, onValid1 } = useVideoInfo()

  useEffect(() => {
    form.setValue('url', input.url)
  }, [])

  async function onSubmit(data: z.infer<typeof formSchema1>) {
    // ステート更新 & 動画愛情報を抽出
    onValid1(data.url)
  }

  const form = useForm<z.infer<typeof formSchema1>>({
    resolver: zodResolver(formSchema1),
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
              <FormLabel>URL</FormLabel>
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
      </form>
    </Form>
  )
}

export default VideoForm1
