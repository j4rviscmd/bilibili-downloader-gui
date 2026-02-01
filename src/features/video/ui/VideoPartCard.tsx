import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video/hooks/useVideoInfo'
import {
  AUDIO_QUALITIES_MAP,
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/lib/constants'
import { buildVideoFormSchema2 } from '@/features/video/lib/formSchema'
import { updatePartSelected } from '@/features/video/model/inputSlice'
import type { Video } from '@/features/video/types'
import { Checkbox } from '@/shared/animate-ui/radix/checkbox'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import { cn } from '@/shared/lib/utils'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { z } from 'zod'

/**
 * Props for VideoPartCard component.
 */
type Props = {
  /** Video metadata */
  video: Video
  /** Part page number (1-indexed) */
  page: number
  /** Whether this part's title duplicates another */
  isDuplicate?: boolean
}

/**
 * Card component for video part settings.
 *
 * Displays a card for a single video part including:
 * - Checkbox for selection
 * - Thumbnail and duration
 * - Custom filename input
 * - Video quality radio buttons (only available qualities shown)
 * - Audio quality radio buttons (only available qualities shown)
 *
 * Responsive layout:
 * - Desktop (≥768px): Horizontal grid with thumbnail, title, and quality selectors
 * - Mobile (<768px): Vertical stack with collapsible sections
 *
 * Changes are auto-saved on blur. Displays duplicate title warning if needed.
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <VideoPartCard video={videoData} page={1} isDuplicate={false} />
 * ```
 */
function VideoPartCard({ video, page, isDuplicate }: Props) {
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
    const syncFormWithVideo = async (): Promise<void> => {
      if (!video || video.parts.length === 0 || video.parts[0].cid === 0) {
        return
      }

      const part = video.parts[page - 1]
      const title =
        video.title === videoPart.part
          ? video.title
          : `${video.title} ${videoPart.part}`
      form.setValue('title', title, {
        shouldValidate: true,
      })
      form.setValue(
        'videoQuality',
        (part.videoQualities[0]?.id || 80).toString(),
        { shouldValidate: true },
      )
      form.setValue(
        'audioQuality',
        (part.audioQualities[0]?.id || 30216).toString(),
        { shouldValidate: true },
      )

      const ok = await form.trigger()
      if (ok) {
        const vals = form.getValues()
        onValid2(page - 1, vals.title, vals.videoQuality, vals.audioQuality)
      }
    }

    syncFormWithVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, page])

  async function onSubmit(data: z.infer<typeof schema2>) {
    onValid2(page - 1, data.title, data.videoQuality, data.audioQuality)
  }

  return (
    <div className="p-4 md:p-6">
      <Form {...form}>
        <fieldset disabled={disabled}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onBlur={form.handleSubmit(onSubmit)}
            className="space-y-4 md:space-y-5"
          >
            {/* Thumbnail and Selection Section */}
            <div className="flex items-start gap-4">
              <div className="flex items-center pt-1">
                <Checkbox
                  checked={selected}
                  onCheckedChange={handleSelectedChange}
                  size="lg"
                />
              </div>
              <div className="flex flex-col gap-2">
                <img
                  src={videoPart.thumbnail.base64.startsWith('data:')
                    ? videoPart.thumbnail.base64
                    : 'data:image/png;base64,' + videoPart.thumbnail.base64}
                  alt={`Thumbnail for ${videoPart.part}`}
                  className="w-24 h-16 md:w-32 md:h-20 rounded-lg object-cover"
                />
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">{videoPart.part}</span>
                  <span className="px-1">/</span>
                  {min > 0 && <span className="mr-1">{min}m</span>}
                  <span>{sec}s</span>
                </div>
              </div>
            </div>

            {/* Title Input */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    {t('video.title_label')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('video.title_placeholder')}
                      className="h-11"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    {t('video.title_description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quality Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Video Quality */}
              <FormField
                control={form.control}
                name="videoQuality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      {t('video.quality_label')}
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        {...field}
                        value={String(field.value)}
                        onValueChange={field.onChange}
                        orientation="horizontal"
                        className="flex flex-col gap-3"
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
                            return (
                              <div
                                key={id}
                                className={cn(
                                  'flex items-center space-x-3 min-h-[44px]',
                                  isDisabled
                                    ? 'text-muted-foreground/60'
                                    : '',
                                )}
                              >
                                <RadioGroupItem
                                  disabled={isDisabled}
                                  value={id}
                                  id={`vq-${id}-${page}`}
                                />
                                <Label
                                  htmlFor={`vq-${id}-${page}`}
                                  className="cursor-pointer"
                                >
                                  {value}
                                </Label>
                              </div>
                            )
                          })}
                      </RadioGroup>
                    </FormControl>
                    <FormDescription className="text-xs">
                      {t('video.quality_description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Audio Quality */}
              <FormField
                control={form.control}
                name="audioQuality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      {t('video.audio_quality_label')}
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        {...field}
                        value={String(field.value)}
                        onValueChange={field.onChange}
                        className="flex flex-col gap-3"
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
                          return (
                            <div
                              key={id}
                              className={cn(
                                'flex items-center space-x-3 min-h-[44px]',
                                isDisabled
                                  ? 'text-muted-foreground/60'
                                  : '',
                              )}
                            >
                              <RadioGroupItem
                                disabled={isDisabled}
                                value={String(id)}
                                id={`aq-${id}-${page}`}
                              />
                              <Label
                                htmlFor={`aq-${id}-${page}`}
                                className="cursor-pointer"
                              >
                                {value}
                              </Label>
                            </div>
                          )
                        })}
                      </RadioGroup>
                    </FormControl>
                    <FormDescription className="text-xs">
                      {t('video.audio_quality_description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Duplicate Warning */}
            {isDuplicate && (
              <div className="text-destructive text-sm mt-2">
                {t('validation.video.title.duplicate')}
              </div>
            )}
          </form>
        </fieldset>
      </Form>
    </div>
  )
}

export default VideoPartCard
