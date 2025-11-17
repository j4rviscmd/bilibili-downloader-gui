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
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

function VideoForm1() {
  const { input, onValid1 } = useVideoInfo()
  const { t } = useTranslation()

  useEffect(() => {
    // Disabled: restore URL from localStorage at startup.
    // Previously this read from `localStorage.getItem(VIDEO_URL_KEY)` and
    // populated the form automatically. To disable automatic restoration,
    // we now always use the current store value as the initial value.
    form.setValue('url', input.url, { shouldValidate: false })
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

  const placeholder =
    t('video.url_placeholder_example') ||
    'e.g. https://www.bilibili.com/video/BV1xxxxxx'
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
              <FormLabel>{t('video.url_label')}</FormLabel>
              <FormControl>
                <Input required placeholder={placeholder} {...field} />
              </FormControl>
              <FormDescription>{t('video.url_description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

export default VideoForm1
