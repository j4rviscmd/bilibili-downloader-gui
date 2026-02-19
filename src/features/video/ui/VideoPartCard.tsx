import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import {
  AUDIO_QUALITIES_MAP,
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/lib/constants'
import { buildVideoFormSchema2 } from '@/features/video/lib/formSchema'
import { extractVideoId, toThumbnailDataUrl } from '@/features/video/lib/utils'
import { updatePartSelected } from '@/features/video/model/inputSlice'
import type { Video } from '@/features/video/types'
import { PartDownloadProgress } from '@/features/video/ui/PartDownloadProgress'
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
  cancelDownload,
  clearQueueItem,
  findCompletedItemForPart,
  selectHasActiveDownloads,
} from '@/shared/queue/queueSlice'
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
import { Check, Copy, ImageOff, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'
import { z } from 'zod'

type QualityRadioOption = {
  id: string
  label: string
  isAvailable: boolean
}

type QualityRadioGroupProps = {
  options: QualityRadioOption[]
  idPrefix: string
}

/** Radio group component for quality selection. Unavailable qualities are disabled. */
function QualityRadioGroup({ options, idPrefix }: QualityRadioGroupProps) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(({ id, label, isAvailable }) => (
        <div
          key={id}
          className={cn(
            'flex min-h-[22px] min-w-[60px] items-center space-x-2 whitespace-nowrap',
            !isAvailable && 'text-muted-foreground/60',
          )}
        >
          <RadioGroupItem
            disabled={!isAvailable}
            value={id}
            id={`${idPrefix}-${id}`}
          />
          <Label
            htmlFor={`${idPrefix}-${id}`}
            className={cn(
              'cursor-pointer',
              !isAvailable && 'cursor-not-allowed',
            )}
          >
            {label}
          </Label>
        </div>
      ))}
    </div>
  )
}

type Props = {
  video: Video
  page: number
  isDuplicate?: boolean
}

/**
 * Video part configuration card component.
 *
 * Displays thumbnail, filename input, quality selectors, and download progress.
 * Changes are auto-saved on blur. Shows a warning for duplicate titles.
 */
function VideoPartCard({ video, page, isDuplicate }: Props) {
  const { onValid2 } = useVideoInfo()
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const disabled = video.parts.length === 0
  const videoPart = video.parts[page - 1]
  const min = Math.floor(videoPart.duration / 60)
  const sec = videoPart.duration % 60

  const downloadStatus = usePartDownloadStatus(page - 1)
  const { isDownloading, isPending, isComplete, downloadId } = downloadStatus

  const hasActiveDownloads = useSelector(selectHasActiveDownloads)

  const partInput = useSelector(
    (state: RootState) => state.input.partInputs[page - 1],
  )
  const selected = partInput?.selected ?? true
  const existingInput = partInput

  const isWaitingForTurn =
    selected && !downloadId && !isComplete && hasActiveDownloads

  const videoQualities = videoPart.videoQualities
  const audioQualities = videoPart.audioQualities

  /**
   * Checks if a quality ID is available for the current video part.
   * @param qualityId - The quality ID to check
   * @param type - Either 'video' or 'audio'
   * @returns True if the quality is available
   */
  function isQualityAvailable(qualityId: number, type: 'video' | 'audio') {
    const qualities = type === 'video' ? videoQualities : audioQualities
    return qualities.some((q) => q.id === qualityId)
  }

  function handleSelectedChange(checked: boolean | 'indeterminate') {
    store.dispatch(
      updatePartSelected({ index: page - 1, selected: checked === true }),
    )
  }

  /**
   * Executes redownload by removing completed item and starting fresh download.
   * Clears the queue item and initiates a new download with a new ID.
   */
  async function handleRedownload() {
    const partIndex = page - 1
    const state = store.getState()
    const partInput = state.input.partInputs[partIndex]
    if (!partInput) return

    const videoId = extractVideoId(state.input.url)
    if (!videoId) return

    const completedItem = findCompletedItemForPart(state, page)
    if (completedItem) {
      store.dispatch(clearQueueItem(completedItem.downloadId))
    }

    const newDownloadId = `${videoId}-${Date.now()}-p${page}`

    await downloadVideo(
      videoId,
      partInput.cid,
      partInput.title.trim(),
      parseInt(partInput.videoQuality || '80', 10),
      parseInt(partInput.audioQuality || '30216', 10),
      newDownloadId,
      newDownloadId.replace(/-p\d+$/, ''),
      partInput.duration,
    )
  }

  /**
   * Re-selects the part for next download execution.
   * Enables the checkbox to allow retrying the download.
   */
  function handleRetry() {
    store.dispatch(updatePartSelected({ index: page - 1, selected: true }))
  }

  /**
   * Cancels the download and deselects to return to pre-download state.
   * Dispatches cancel action and unchecks the part selection.
   */
  function handleCancel() {
    if (downloadStatus.downloadId) {
      store.dispatch(cancelDownload(downloadStatus.downloadId))
    }
    // Deselect to return to pre-download state (no waiting indicator)
    store.dispatch(updatePartSelected({ index: page - 1, selected: false }))
  }

  /**
   * Copies the video part name to clipboard with toast notification.
   * Shows success or error toast based on clipboard operation result.
   */
  async function handleCopyPartName() {
    try {
      await navigator.clipboard.writeText(videoPart.part)
      setCopied(true)
      toast.success(t('video.title_copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('video.copy_failed'))
    }
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
    if (!video || video.parts.length === 0 || video.parts[0].cid === 0) return

    const part = video.parts[page - 1]
    const defaultTitle =
      video.title === videoPart.part
        ? video.title
        : `${video.title} ${videoPart.part}`

    const title = existingInput?.title ?? defaultTitle
    const videoQuality =
      existingInput?.videoQuality ?? String(part.videoQualities[0]?.id ?? 80)
    const audioQuality =
      existingInput?.audioQuality ?? String(part.audioQualities[0]?.id ?? 30216)

    form.setValue('title', title, { shouldValidate: true })
    form.setValue('videoQuality', videoQuality, { shouldValidate: true })
    form.setValue('audioQuality', audioQuality, { shouldValidate: true })

    form.trigger().then((isValid) => {
      if (isValid && !existingInput) {
        onValid2(page - 1, title, videoQuality, audioQuality)
      }
    })
  }, [video, page, existingInput, form, onValid2, videoPart.part])

  function onSubmit(data: z.infer<typeof schema2>) {
    onValid2(page - 1, data.title, data.videoQuality, data.audioQuality)
  }

  return (
    <div className="p-3 md:p-4">
      <Form {...form}>
        <fieldset
          disabled={
            disabled || isDownloading || isPending || hasActiveDownloads
          }
        >
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
                {videoPart.thumbnail.base64 ? (
                  <img
                    src={toThumbnailDataUrl(videoPart.thumbnail.base64)}
                    alt={t('video.thumbnail_alt', { part: videoPart.part })}
                    className="h-16 w-24 rounded-lg object-cover md:h-20 md:w-32"
                  />
                ) : (
                  <div className="bg-muted flex h-16 w-24 items-center justify-center rounded-lg md:h-20 md:w-32">
                    <ImageOff className="text-muted-foreground/50 h-8 w-8" />
                  </div>
                )}

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
                <button
                  type="button"
                  onClick={handleCopyPartName}
                  className="hover:bg-muted mr-0.5 rounded p-1 transition-colors"
                  title={t('video.copy_title')}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
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
                {min > 0 && <span>{min}m</span>}
                <span>{sec}s</span>
              </div>
            </div>

            {/* Quality Selectors */}
            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-1 gap-2">
                {/* Quality Limited Warning */}
                {video.isLimitedQuality && (
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                    <div className="flex items-start gap-2">
                      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-medium text-amber-900 dark:text-amber-100">
                          {t('video.quality_limited_title')}
                        </p>
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {t('video.quality_limited_description')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
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
                          <TooltipContent
                            side="top"
                            className="max-w-xs text-xs"
                          >
                            <p>{t('video.quality_description')}</p>
                            <p className="mt-1">{t('video.quality_note')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <FormControl>
                        <RadioGroup
                          value={String(field.value)}
                          onValueChange={field.onChange}
                        >
                          <QualityRadioGroup
                            idPrefix={`vq-${page}`}
                            options={Object.entries(VIDEO_QUALITIES_MAP)
                              .reverse()
                              .map(([id, label]) => ({
                                id,
                                label,
                                isAvailable: isQualityAvailable(
                                  Number(id),
                                  'video',
                                ),
                              }))}
                          />
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
                          <TooltipContent
                            side="top"
                            className="max-w-xs text-xs"
                          >
                            <p>{t('video.audio_quality_description')}</p>
                            <p className="mt-1">
                              {t('video.audio_quality_note')}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <FormControl>
                        <RadioGroup
                          value={String(field.value)}
                          onValueChange={field.onChange}
                        >
                          <QualityRadioGroup
                            idPrefix={`aq-${page}`}
                            options={AUDIO_QUALITIES_ORDER.map((id) => ({
                              id: String(id),
                              label: AUDIO_QUALITIES_MAP[id],
                              isAvailable: isQualityAvailable(
                                Number(id),
                                'audio',
                              ),
                            }))}
                          />
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

        {/* Download Progress Section */}
        {(downloadStatus.downloadId || isWaitingForTurn) && (
          <PartDownloadProgress
            status={downloadStatus}
            isWaitingForTurn={isWaitingForTurn}
            onRedownload={handleRedownload}
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
        )}
      </Form>
    </div>
  )
}

export default VideoPartCard
