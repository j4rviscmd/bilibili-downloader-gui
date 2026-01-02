import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import { Checkbox } from '@/components/animate-ui/radix/checkbox'
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
import {
  AUDIO_QUALITIES_MAP,
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/constants'
import { buildVideoFormSchema2 } from '@/features/video/formSchema'
import { updatePartSelected } from '@/features/video/inputSlice'
import type { Video } from '@/features/video/types'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
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

  // 選択状態を取得
  const selected = useSelector(
    (state: RootState) => state.input.partInputs[page - 1]?.selected ?? true,
  )

  // 選択状態を更新
  const handleSelectedChange = (checked: boolean | 'indeterminate') => {
    store.dispatch(
      updatePartSelected({ index: page - 1, selected: checked === true }),
    )
  }

  const schema2 = useMemo(() => buildVideoFormSchema2(t), [t])
  const form = useForm<z.infer<typeof schema2>>({
    resolver: zodResolver(schema2),
    defaultValues: {
      title: '',
      videoQuality: '80',
      audioQuality: '30216',
    },
  })

  useEffect(() => {
    ;(async () => {
      if (video && video.parts.length > 0 && video.parts[0].cid !== 0) {
        form.setValue('title', video.title + ' ' + videoPart.part, {
          shouldValidate: true,
        })
        form.setValue(
          'videoQuality',
          (video.parts[page - 1].videoQualities[0]?.id || 80).toString(),
          { shouldValidate: true },
        )
        form.setValue(
          'audioQuality',
          (video.parts[page - 1].audioQualities[0]?.id || 30216).toString(),
          { shouldValidate: true },
        )
        const ok = await form.trigger()
        if (ok) {
          const vals = form.getValues()
          onValid2(page - 1, vals.title, vals.videoQuality, vals.audioQuality)
        }
      }
    })()
  }, [video])

  async function onSubmit(data: z.infer<typeof schema2>) {
    onValid2(page - 1, data.title, data.videoQuality, data.audioQuality)
  }

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
            <div className="grid grid-cols-24 items-center gap-3">
              <div className="col-span-12 flex h-full gap-3">
                <div className="flex items-center">
                  <Checkbox
                    checked={selected}
                    onCheckedChange={handleSelectedChange}
                    size="lg"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <img
                    src={'data:image/png;base64,' + videoPart.thumbnail.base64}
                    alt="thumbnail"
                  />
                  <div className="block">
                    <span>{videoPart.part}</span>
                    <span className="px-1">/</span>
                    {min > 0 && <span className="mr-1">{min}m</span>}
                    <span>{sec}s</span>
                  </div>
                </div>
              </div>
              {/* Video Quality */}
              <FormField
                control={form.control}
                name="videoQuality"
                render={({ field }) => (
                  <FormItem className="col-span-6 h-fit">
                    <FormLabel>{t('video.quality_label')}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        {...field}
                        value={String(field.value)}
                        onValueChange={field.onChange}
                        orientation="horizontal"
                      >
                        {Object.entries(VIDEO_QUALITIES_MAP)
                          .reverse()
                          .map(([id, value]) => {
                            let isDisabled = true
                            if (
                              video.parts.length > 0 &&
                              video.parts[page - 1].cid !== 0
                            ) {
                              if (
                                video.parts[page - 1].videoQualities.find(
                                  (v) => v.id === Number(id),
                                )
                              ) {
                                isDisabled = false
                              }
                            }
                            // if (isDisabled) {
                            //   console.log('videoQuality disabled', {
                            //     id,
                            //     value,
                            //   })
                            // }
                            return (
                              <div
                                key={id}
                                className={cn(
                                  'flex items-center space-x-3',
                                  isDisabled ? 'text-muted-foreground/60' : '',
                                )}
                              >
                                <RadioGroupItem
                                  disabled={isDisabled}
                                  value={id}
                                />
                                <Label htmlFor={`vq-${id}`}>{value}</Label>
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
              {/* Audio Quality */}
              <FormField
                control={form.control}
                name="audioQuality"
                render={({ field }) => (
                  <FormItem className="col-span-6 h-fit">
                    <FormLabel>{t('video.audio_quality_label')}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        {...field}
                        value={String(field.value)}
                        onValueChange={field.onChange}
                      >
                        {AUDIO_QUALITIES_ORDER.map((id) => {
                          const value = AUDIO_QUALITIES_MAP[id]
                          let isDisabled = true
                          if (
                            video.parts.length > 0 &&
                            video.parts[page - 1].cid !== 0
                          ) {
                            if (
                              video.parts[page - 1].audioQualities.find(
                                (v) => v.id === Number(id),
                              )
                            ) {
                              isDisabled = false
                            }
                          }
                          // if (isDisabled) {
                          //   console.log('audioQuality disabled', {
                          //     id,
                          //     value,
                          //   })
                          // }
                          return (
                            <div
                              key={id}
                              className={cn(
                                'flex items-center space-x-3',
                                isDisabled ? 'text-muted-foreground/60' : '',
                              )}
                            >
                              <RadioGroupItem
                                disabled={isDisabled}
                                value={String(id)}
                              />
                              <Label htmlFor={`aq-${id}`}>{value}</Label>
                            </div>
                          )
                        })}
                      </RadioGroup>
                    </FormControl>
                    <FormDescription>
                      {t('video.audio_quality_description')}
                      <br />
                      {t('video.audio_quality_note')}
                      <br />
                    </FormDescription>
                    <FormMessage />
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
