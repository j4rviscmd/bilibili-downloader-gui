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
import { VIDEO_URL_KEY } from '@/features/video/constants'
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
    const restoreUrl = localStorage.getItem(VIDEO_URL_KEY)
    if (restoreUrl) {
      form.setValue('url', restoreUrl, { shouldValidate: true })
      // Video情報(form2系)の初期化
      onValid1(restoreUrl)
    } else {
      // 初期値を設定
      form.setValue('url', input.url, { shouldValidate: false })
    }
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
