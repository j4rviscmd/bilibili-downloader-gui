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
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { Info } from 'lucide-react'
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

  // 選択状態と既存の入力値を取得
  const selected = useSelector(
    (state: RootState) => state.input.partInputs[page - 1]?.selected ?? true,
  )
  const existingInput = useSelector(
    (state: RootState) => state.input.partInputs[page - 1],
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
      const defaultTitle =
        video.title === videoPart.part
          ? video.title
          : `${video.title} ${videoPart.part}`

      // 既にユーザーが設定した値があれば、それをフォームにセット
      // なければデフォルト値をセットしてRedux storeに保存
      const title = existingInput?.title || defaultTitle
      const videoQuality = existingInput?.videoQuality || (part.videoQualities[0]?.id || 80).toString()
      const audioQuality = existingInput?.audioQuality || (part.audioQualities[0]?.id || 30216).toString()

      form.setValue('title', title, {
        shouldValidate: true,
      })
      form.setValue('videoQuality', videoQuality, {
        shouldValidate: true,
      })
      form.setValue('audioQuality', audioQuality, {
        shouldValidate: true,
      })

      const ok = await form.trigger()
      if (ok) {
        // 初期化時のみRedux storeを更新（既存値がある場合は更新しない）
        if (!existingInput) {
          const vals = form.getValues()
          onValid2(page - 1, vals.title, vals.videoQuality, vals.audioQuality)
        }
      }
    }

    syncFormWithVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, page, existingInput])

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
            className="space-y-2"
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
                  src={
                    videoPart.thumbnail.base64.startsWith('data:')
                      ? videoPart.thumbnail.base64
                      : 'data:image/png;base64,' + videoPart.thumbnail.base64
                  }
                  alt={`Thumbnail for ${videoPart.part}`}
                  className="h-16 w-24 rounded-lg object-cover md:h-20 md:w-32"
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
                            className="min-h-[52px] resize-none"
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
              <div
                className="text-muted-foreground mt-1.5 flex items-center text-sm"
                style={{ marginLeft: '2.25rem' }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-block max-w-[200px] cursor-help truncate font-medium md:max-w-[300px]"
                      title={videoPart.part}
                    >
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
              <div className="grid grid-cols-1 gap-2">
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
                            <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              {t('video.quality_description')}
                            </p>
                            <p className="mt-1 text-xs">
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
                              const isDisabled =
                                video.parts.length === 0 ||
                                video.parts[page - 1].cid === 0 ||
                                !video.parts[page - 1].videoQualities.some(
                                  (v) => v.id === Number(id),
                                )
                              return (
                                <div
                                  key={id}
                                  className={cn(
                                    'flex min-h-[36px] min-w-[80px] items-center space-x-2 whitespace-nowrap',
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
                            <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              {t('video.audio_quality_description')}
                            </p>
                            <p className="mt-1 text-xs">
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
                            const isDisabled =
                              video.parts.length === 0 ||
                              video.parts[page - 1].cid === 0 ||
                              !video.parts[page - 1].audioQualities.some(
                                (v) => v.id === Number(id),
                              )
                            return (
                              <div
                                key={id}
                                className={cn(
                                  'flex min-h-[36px] min-w-[80px] items-center space-x-2 whitespace-nowrap',
                                  isDisabled ? 'text-muted-foreground/60' : '',
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
              <div className="text-destructive mt-1 text-sm">
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
