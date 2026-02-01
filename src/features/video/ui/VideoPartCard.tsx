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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Textarea } from '@/shared/ui/textarea'
import { Label } from '@/shared/ui/label'
import { Info } from 'lucide-react'
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
    <div className="p-3 md:p-4">
      <Form {...form}>
        <fieldset disabled={disabled}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onBlur={form.handleSubmit(onSubmit)}
            className="space-y-3 md:space-y-4"
          >
            {/* Thumbnail and Title Section */}
            <div>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selected}
                  onCheckedChange={handleSelectedChange}
                  size="lg"
                />
                <img
                  src={videoPart.thumbnail.base64.startsWith('data:')
                    ? videoPart.thumbnail.base64
                    : 'data:image/png;base64,' + videoPart.thumbnail.base64}
                  alt={`Thumbnail for ${videoPart.part}`}
                  className="w-24 h-16 md:w-32 md:h-20 rounded-lg object-cover"
                />

                {/* Title Input */}
                <div className="flex-1">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">
                          {t('video.title_label')}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('video.title_placeholder')}
                            className="min-h-[60px] resize-none"
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Video Part Name and Duration */}
              <div className="mt-2 flex items-center text-sm text-muted-foreground" style={{ marginLeft: '2.25rem' }}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium max-w-[200px] md:max-w-[300px] truncate inline-block cursor-help" title={videoPart.part}>
                      {videoPart.part}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-sm">{videoPart.part}</p>
                  </TooltipContent>
                </Tooltip>
                <span className="px-1">/</span>
                {min > 0 && <span className="mr-1">{min}m</span>}
                <span>{sec}s</span>
              </div>
            </div>

            {/* Quality Selectors */}
            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-1 gap-3">
                {/* Video Quality */}
                <FormField
                  control={form.control}
                  name="videoQuality"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">
                          {t('video.quality_label')}
                        </FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              {t('video.quality_description')}
                            </p>
                            <p className="text-xs mt-1">
                              {t('video.quality_note')}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <FormControl>
                        <RadioGroup
                          {...field}
                          value={String(field.value)}
                          onValueChange={field.onChange}
                          orientation="horizontal"
                          className="flex flex-wrap gap-x-4 gap-y-2"
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
                                    'flex items-center space-x-2 min-h-[36px]',
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
                                    className={cn(
                                      'cursor-pointer',
                                      isDisabled && 'cursor-not-allowed',
                                    )}
                                  >
                                    {value}
                                  </Label>
                                </div>
                              )
                            })}
                        </RadioGroup>
                      </FormControl>
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
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">
                          {t('video.audio_quality_label')}
                        </FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              {t('video.audio_quality_description')}
                            </p>
                            <p className="text-xs mt-1">
                              {t('video.audio_quality_note')}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <FormControl>
                        <RadioGroup
                          {...field}
                          value={String(field.value)}
                          onValueChange={field.onChange}
                          className="flex flex-wrap gap-x-4 gap-y-2"
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
                                  'flex items-center space-x-2 min-h-[36px]',
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
                                  className={cn(
                                    'cursor-pointer',
                                    isDisabled && 'cursor-not-allowed',
                                  )}
                                >
                                  {value}
                                </Label>
                              </div>
                            )
                          })}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TooltipProvider>

            {/* Duplicate Warning */}
            {isDuplicate && (
              <div className="text-destructive text-sm mt-1">
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
