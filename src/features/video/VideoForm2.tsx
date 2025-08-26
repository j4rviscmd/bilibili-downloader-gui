import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/animate-ui/radix/radio-group'
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
import { Label } from '@/components/ui/label'
import { VIDEO_QUALITIES_MAP } from '@/features/video/constants'
import { formSchema2 } from '@/features/video/formSchema'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { cn } from '../../lib/utils'

function VideoForm2() {
  const { video, onValid2 } = useVideoInfo()
  const { t } = useTranslation()

  useEffect(() => {
    ;(async () => {
      if (video && video.cid !== 0) {
        // 値をフォームに反映
        form.setValue('title', video.title, { shouldValidate: true })
        form.setValue('quality', (video.qualities[0]?.id || 80).toString(), {
          shouldValidate: true,
        })
        // 値セット後にバリデーションを実行
        const ok = await form.trigger()
        // バリデーション成功時にReduxへ反映（ダウンロードボタン活性のため）
        if (ok) {
          const vals = form.getValues()
          onValid2(vals.title, vals.quality)
        }
      }
    })()
  }, [video])

  async function onSubmit(data: z.infer<typeof formSchema2>) {
    // ステート更新 & 動画愛情報を抽出
    onValid2(data.title, data.quality)
  }

  const form = useForm<z.infer<typeof formSchema2>>({
    resolver: zodResolver(formSchema2),
    defaultValues: {
      title: '',
      quality: '80',
    },
  })

  const disabled = video.cid === 0

  return (
    <Form {...form}>
      <fieldset disabled={disabled}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          onBlur={form.handleSubmit(onSubmit)}
          className="space-y-8"
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('video.title_label')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('video.title_placeholder')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('video.title_description')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="quality"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('video.quality_label')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    {...field}
                    value={String(field.value)}
                    onValueChange={field.onChange}
                  >
                    {Object.entries(VIDEO_QUALITIES_MAP)
                      .reverse() // 高画質から順に表示
                      .map((q) => {
                        const id = q[0]
                        const value = q[1]
                        let disabled = true
                        if (video.cid !== 0) {
                          if (
                            video.qualities.find((v) => v.id === Number(id))
                          ) {
                            disabled = false
                          }
                        }
                        return (
                          <div
                            key={id}
                            className={cn(
                              'flex items-center space-x-3',
                              disabled ? 'text-muted-foreground/60' : '',
                            )}
                          >
                            <RadioGroupItem disabled={disabled} value={id} />
                            <Label htmlFor="r1">{value}</Label>
                          </div>
                        )
                      })}
                  </RadioGroup>
                </FormControl>
                <FormDescription>
                  {t('video.quality_description')}
                  <br />
                  {t('video.quality_note')}
                  <br />
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </fieldset>
    </Form>
  )
}

export default VideoForm2
