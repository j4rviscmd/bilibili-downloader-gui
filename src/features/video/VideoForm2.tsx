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
import { buildVideoFormSchema2 } from '@/features/video/formSchema'
import type { Video } from '@/features/video/types'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { cn } from '../../lib/utils'

type Props = {
  video: Video
  page: number
  isDuplicate?: boolean
}
function VideoForm2({ video, page, isDuplicate }: Props) {
  const { onValid2 } = useVideoInfo()
  const { t } = useTranslation()
  const disabled = video.parts.length === 0
  const videoPart = video.parts[page - 1]
  const min = Math.floor(videoPart.duration / 60)
  const sec = videoPart.duration % 60

  useEffect(() => {
    ;(async () => {
      if (video && video.parts.length > 0 && video.parts[0].cid !== 0) {
        // 値をフォームに反映
        form.setValue('title', video.title + '_' + videoPart.part, {
          shouldValidate: true,
        })
        form.setValue(
          'quality',
          (video.parts[page - 1].qualities[0]?.id || 80).toString(),
          {
            shouldValidate: true,
          },
        )
        // 値セット後にバリデーションを実行
        const ok = await form.trigger()
        // バリデーション成功時にReduxへ反映（ダウンロードボタン活性のため）
        if (ok) {
          const vals = form.getValues()
          onValid2(page - 1, vals.title, vals.quality)
        }
      }
    })()
  }, [video])

  const schema2 = useMemo(() => buildVideoFormSchema2(t), [t])

  async function onSubmit(data: z.infer<typeof schema2>) {
    // ステート更新 & 動画愛情報を抽出
    onValid2(page - 1, data.title, data.quality)
  }

  const form = useForm<z.infer<typeof schema2>>({
    resolver: zodResolver(schema2),
    defaultValues: {
      title: '',
      quality: '80',
    },
  })

  return (
    <div className="p-3">
      <Form {...form}>
        <fieldset disabled={disabled}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onBlur={form.handleSubmit(onSubmit)}
            className="space-y-3"
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
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-5 flex h-full flex-col justify-center">
                <img
                  src={'data:image/png;base64,' + videoPart.thumbnail.base64}
                  alt="thumbnail"
                />
                <div className="flex">
                  <div>{videoPart.part}</div>
                  <div className="px-1">/</div>
                  {min > 0 && <div className="mr-1">{min}m</div>}
                  <div>{sec}s</div>
                </div>
              </div>
              <FormField
                control={form.control}
                name="quality"
                render={({ field }) => (
                  <FormItem className="col-span-7">
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
                            if (
                              video.parts.length > 0 &&
                              video.parts[page - 1].cid !== 0
                            ) {
                              if (
                                video.parts[page - 1].qualities.find(
                                  (v) => v.id === Number(id),
                                )
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
                                <RadioGroupItem
                                  disabled={disabled}
                                  value={id}
                                />
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
                    {isDuplicate && (
                      <div className="text-destructive text-sm">
                        {t('validation.video.title.duplicate')}
                      </div>
                    )}
                  </FormItem>
                )}
              />
            </div>
          </form>
        </fieldset>
      </Form>
    </div>
  )
}

export default VideoForm2
