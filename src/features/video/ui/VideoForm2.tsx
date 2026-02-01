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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { zodResolver } from '@hookform/resolvers/zod'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { z } from 'zod'

/**
 * Props for VideoForm2 component.
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
 * Form for video part settings (Step 2).
 *
 * Displays settings for a single video part including:
 * - Checkbox for selection
 * - Thumbnail and duration
 * - Custom filename input
 * - Video quality radio buttons (only available qualities shown)
 * - Audio quality radio buttons (only available qualities shown)
 *
 * Changes are auto-saved on blur. Displays duplicate title warning if needed.
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <VideoForm2 video={videoData} page={1} isDuplicate={false} />
 * ```
 */
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

  // 初回マウント時のみデフォルト値を設定するフラグ
  const isInitialized = useRef(false)

  useEffect(() => {
    const syncFormWithVideo = async (): Promise<void> => {
      if (!video || video.parts.length === 0 || video.parts[0].cid === 0) {
        return
      }

      // 初回マウント時のみデフォルト値を設定
      // ページ遷移時などはユーザーが選択した値を維持するためスキップ
      if (isInitialized.current) {
        return
      }
      isInitialized.current = true

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
            <TooltipProvider delayDuration={200}>
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
                      src={
                        videoPart.thumbnail.base64.startsWith('data:')
                          ? videoPart.thumbnail.base64
                          : 'data:image/png;base64,' +
                            videoPart.thumbnail.base64
                      }
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
                    <FormItem className="col-span-12 h-fit">
                      <div className="flex items-center gap-1.5">
                        <FormLabel>{t('video.quality_label')}</FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
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
                                    'flex min-w-[80px] items-center space-x-3 whitespace-nowrap',
                                    isDisabled
                                      ? 'text-muted-foreground/60'
                                      : '',
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
                    <FormItem className="col-span-12 h-fit">
                      <div className="flex items-center gap-1.5">
                        <FormLabel>{t('video.audio_quality_label')}</FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
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
                                  'flex min-w-[80px] items-center space-x-3 whitespace-nowrap',
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
            </TooltipProvider>
          </form>
        </fieldset>
      </Form>
    </div>
  )
}

export default VideoForm2
