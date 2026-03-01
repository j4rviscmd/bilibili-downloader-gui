import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/animate-ui/components/radix/accordion'
import { useVideoInfo } from '@/features/video'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import {
  fetchBangumiPartQualities,
  fetchPartQualities,
  fetchSubtitlesForPart,
} from '@/features/video/api/fetchVideoInfo'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import {
  AUDIO_QUALITIES_MAP,
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/lib/constants'
import { buildVideoFormSchema2 } from '@/features/video/lib/formSchema'
import { buildVideoUrl } from '@/features/video/lib/utils'
import {
  defaultSubtitleConfig,
  setAccordionOpen,
  setPartQualities,
  setPartSubtitles,
  setQualitiesLoading,
  setSubtitlesLoading,
  updatePartSelected,
  updateSubtitleConfig,
} from '@/features/video/model/inputSlice'
import type { Video } from '@/features/video/types'
import { PartDownloadProgress } from '@/features/video/ui/PartDownloadProgress'
import { QualityRadioGroup } from '@/features/video/ui/QualityRadioGroup'
import { SubtitleSection } from '@/features/video/ui/SubtitleSection'
import { Checkbox } from '@/shared/animate-ui/radix/checkbox'
import { RadioGroup } from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { clearProgressByDownloadId } from '@/shared/progress/progressSlice'
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
import { Skeleton } from '@/shared/ui/skeleton'
import { Textarea } from '@/shared/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Copy, ImageOff, Info } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'
import { z } from 'zod'

/**
 * Props for the VideoPartCard component.
 */
type Props = {
  /** Video data containing all parts and metadata. */
  video: Video
  /** 1-based page number indicating which part to display. */
  page: number
  /** Whether the title is a duplicate of another part's title. */
  isDuplicate?: boolean
}

/**
 * Computes the default title for a video part.
 *
 * Returns the video title for single-part videos, or combines video
 * title with part name for multi-part videos.
 */
function computeDefaultTitle(
  video: Video,
  videoPart: { part: string },
): string {
  const hasValidParts = video?.parts.length && video.parts[0].cid !== 0
  if (!hasValidParts) return ''
  return video.title === videoPart.part
    ? video.title
    : `${video.title} ${videoPart.part}`
}

/**
 * Video part configuration card component.
 *
 * Displays thumbnail, filename input, quality selectors, and download
 * progress. Changes are auto-saved on blur. Shows a warning for
 * duplicate titles. Wrapped with `React.memo` to skip re-renders when
 * props are shallowly equal.
 */
const VideoPartCard = memo(function VideoPartCard({
  video,
  page,
  isDuplicate,
}: Props) {
  const { onValid2 } = useVideoInfo()
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const disabled = video.parts.length === 0
  const videoPart = video.parts[page - 1]
  const min = Math.floor(videoPart.duration / 60)
  const sec = videoPart.duration % 60

  const downloadStatus = usePartDownloadStatus(page - 1)
  const { isDownloading, isPending, isComplete } = downloadStatus
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)

  const partInput = useSelector(
    (state: RootState) => state.input.partInputs[page - 1],
  )
  const selected = partInput?.selected ?? true
  const isWaitingForTurn =
    selected && !downloadStatus.downloadId && !isComplete && hasActiveDownloads

  const subtitle = partInput?.subtitle
  const isSubtitleInvalid =
    subtitle && subtitle.mode !== 'off' && !subtitle.selectedLans?.length
  const subtitles = partInput?.subtitles ?? []
  const subtitlesLoading = partInput?.subtitlesLoading ?? false

  const videoQualities = partInput?.videoQualities
  const audioQualities = partInput?.audioQualities
  const qualitiesLoading = partInput?.qualitiesLoading ?? false
  const isPreview = partInput?.isPreview ?? false
  const resolvedQuality = partInput?.resolvedQuality
  const resolvedSubtitle = partInput?.resolvedSubtitle

  /**
   * Builds the summary label for the accordion trigger.
   * Combines quality and subtitle information into a compact display.
   */
  const summaryLabel = useMemo(() => {
    if (!resolvedQuality && !resolvedSubtitle) return null

    const parts: string[] = []

    if (resolvedQuality) {
      const videoLabel =
        VIDEO_QUALITIES_MAP[resolvedQuality.videoQuality] ||
        String(resolvedQuality.videoQuality)
      parts.push(videoLabel)

      if (resolvedQuality.audioQuality !== null) {
        const audioLabel =
          AUDIO_QUALITIES_MAP[resolvedQuality.audioQuality] ||
          String(resolvedQuality.audioQuality)
        parts.push(audioLabel)
      }
    }

    if (resolvedSubtitle && resolvedSubtitle.subtitleMode !== 'off') {
      const modeLabel =
        resolvedSubtitle.subtitleMode === 'soft'
          ? t('video.subtitle_soft')
          : t('video.subtitle_hard')
      const labels = resolvedSubtitle.subtitleLanguageLabels
      const langDisplay =
        labels.length > 2
          ? t('video.subtitle_n_languages', { count: labels.length })
          : labels.join('・')
      parts.push(`${t('video.subtitle')}(${modeLabel}・${langDisplay})`)
    }

    return parts.join(' / ')
  }, [resolvedQuality, resolvedSubtitle, t])

  /**
   * Whether any quality (video or audio) was substituted with a fallback
   * due to the originally requested quality being unavailable.
   * Drives the warning icon in the accordion trigger.
   */
  const hasFallback = useMemo(() => {
    if (!resolvedQuality) return false
    return (
      resolvedQuality.videoQualityFallback ||
      resolvedQuality.audioQualityFallback
    )
  }, [resolvedQuality])

  /**
   * Controlled value for the Accordion component derived from Redux state.
   * An empty array closes the accordion; `['options']` opens it.
   */
  const accordionValue = useMemo(
    () => (partInput?.accordionOpen ? ['options'] : []),
    [partInput?.accordionOpen],
  )

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
  }, [])
  /**
   * Transition override applied only on initial mount when the accordion is
   * already open (e.g. restored from Redux state). Prevents the animated
   * expand from playing on page load by forcing zero duration.
   */
  const accordionTransition =
    !mountedRef.current && partInput?.accordionOpen
      ? { duration: 0 }
      : undefined

  /**
   * Handles accordion open/close state changes.
   * Fetches qualities and subtitles in parallel when the accordion is
   * opened for the first time.
   */
  const handleAccordionChange = useCallback(
    async (value: string[]) => {
      const isOpen = value.includes('options')
      const partIndex = page - 1
      store.dispatch(setAccordionOpen({ index: partIndex, open: isOpen }))

      if (!isOpen) return

      const isBangumi = video.contentType === 'bangumi'
      const epId = videoPart.epId

      const shouldFetchQualities =
        videoQualities === undefined && !qualitiesLoading
      const shouldFetchSubtitles = subtitles.length === 0 && !subtitlesLoading

      if (shouldFetchQualities) {
        if (isBangumi && !epId) {
          store.dispatch(
            setPartQualities({
              index: partIndex,
              videoQualities: [],
              audioQualities: [],
            }),
          )
        } else {
          store.dispatch(
            setQualitiesLoading({ index: partIndex, loading: true }),
          )
        }
      }
      if (shouldFetchSubtitles) {
        store.dispatch(setSubtitlesLoading({ index: partIndex, loading: true }))
      }

      async function fetchQualities() {
        try {
          if (isBangumi && epId) {
            const [vq, aq, isPreview] = await fetchBangumiPartQualities(
              epId,
              videoPart.cid,
            )
            store.dispatch(
              setPartQualities({
                index: partIndex,
                videoQualities: vq,
                audioQualities: aq,
                isPreview: isPreview ?? undefined,
              }),
            )
          } else {
            const [vq, aq] = await fetchPartQualities(video.bvid, videoPart.cid)
            store.dispatch(
              setPartQualities({
                index: partIndex,
                videoQualities: vq,
                audioQualities: aq,
              }),
            )
          }
        } catch (e) {
          console.error('Failed to fetch qualities:', e)
          store.dispatch(
            setPartQualities({
              index: partIndex,
              videoQualities: [],
              audioQualities: [],
            }),
          )
        }
      }

      async function fetchSubtitles() {
        try {
          const fetchedSubtitles = await fetchSubtitlesForPart(
            video.bvid,
            videoPart.cid,
          )
          store.dispatch(
            setPartSubtitles({ index: partIndex, subtitles: fetchedSubtitles }),
          )
        } catch (e) {
          console.error('Failed to fetch subtitles:', e)
          store.dispatch(setPartSubtitles({ index: partIndex, subtitles: [] }))
        }
      }

      const tasks: Promise<void>[] = []
      if (shouldFetchQualities && !(isBangumi && !epId))
        tasks.push(fetchQualities())
      if (shouldFetchSubtitles) tasks.push(fetchSubtitles())
      await Promise.all(tasks)
    },
    [
      page,
      video.bvid,
      video.contentType,
      videoPart.cid,
      videoPart.epId,
      videoQualities,
      qualitiesLoading,
      subtitles.length,
      subtitlesLoading,
    ],
  )

  /**
   * Checks if a quality ID is available for the current video part.
   * @param qualityId - The quality ID to check
   * @param type - Either 'video' or 'audio'
   * @returns True if the quality is available
   */
  const isQualityAvailable = useCallback(
    (qualityId: number, type: 'video' | 'audio') => {
      const qualities =
        type === 'video' ? (videoQualities ?? []) : (audioQualities ?? [])
      return qualities.some((q) => q.id === qualityId)
    },
    [videoQualities, audioQualities],
  )

  /**
   * Handles checkbox selection state changes for the video part.
   */
  const handleSelectedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      store.dispatch(
        updatePartSelected({ index: page - 1, selected: checked === true }),
      )
    },
    [page],
  )

  /**
   * Executes redownload by removing completed item and starting
   * fresh download. Clears the queue item, progress entries, and
   * initiates a new download with a new ID.
   */
  const handleRedownload = useCallback(async () => {
    const partIndex = page - 1
    const state = store.getState()
    const pi = state.input.partInputs[partIndex]

    if (!pi) return

    // Use video.bvid (works for both regular videos and bangumi)
    const videoId = video.bvid

    const completedItem = findCompletedItemForPart(state, page)
    if (completedItem) {
      store.dispatch(clearQueueItem(completedItem.downloadId))
      store.dispatch(clearProgressByDownloadId(completedItem.downloadId))
    }

    const newDownloadId = `${videoId}-${Date.now()}-p${page}`
    const videoQuality = pi.videoQuality || String(pi.videoQualities?.[0]?.id)
    const audioQuality = pi.audioQuality
      ? parseInt(pi.audioQuality, 10)
      : pi.audioQualities?.[0]?.id || null

    await downloadVideo(
      videoId,
      pi.cid,
      pi.title.trim(),
      parseInt(videoQuality, 10),
      audioQuality,
      newDownloadId,
      newDownloadId.replace(/-p\d+$/, ''),
      pi.duration,
      pi.thumbnailUrl,
      pi.page,
      pi.subtitle,
      videoPart.epId,
    )
  }, [page, video.bvid, videoPart.epId])

  /**
   * Handles retry action by re-selecting the part for download.
   */
  const handleRetry = useCallback(() => {
    store.dispatch(updatePartSelected({ index: page - 1, selected: true }))
  }, [page])

  /**
   * Handles cancel action by stopping the current download and deselecting the part.
   */
  const handleCancel = useCallback(() => {
    if (downloadStatus.downloadId) {
      store.dispatch(cancelDownload(downloadStatus.downloadId))
    }
    store.dispatch(updatePartSelected({ index: page - 1, selected: false }))
  }, [page, downloadStatus.downloadId])

  /**
   * Copies the video part name to clipboard.
   * Shows a success toast and resets the copied state after 2 seconds.
   */
  const handleCopyPartName = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(videoPart.part)
      setCopied(true)
      toast.success(t('video.title_copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('video.copy_failed'))
    }
  }, [videoPart.part, t])

  /**
   * Opens the video in browser when thumbnail is clicked.
   */
  const handleThumbnailClick = useCallback(() => {
    const url = buildVideoUrl(video.bvid, page)
    openUrl(url)
  }, [video.bvid, page])

  /**
   * Handles subtitle configuration changes.
   * Dispatches the updated config to Redux store.
   */
  const handleSubtitleConfigChange = useCallback(
    (config: Parameters<typeof updateSubtitleConfig>[0]['config']) => {
      store.dispatch(updateSubtitleConfig({ index: page - 1, config }))
    },
    [page],
  )

  const schema2 = useMemo(() => buildVideoFormSchema2(t), [t])

  const initialTitle = useMemo(
    () => partInput?.title ?? computeDefaultTitle(video, videoPart),
    [partInput?.title, video, videoPart],
  )

  const form = useForm<z.infer<typeof schema2>>({
    resolver: zodResolver(schema2),
    defaultValues: {
      title: initialTitle,
      videoQuality: partInput?.videoQuality || '',
      audioQuality: partInput?.audioQuality || '',
    },
  })

  useEffect(() => {
    if (!video || video.parts.length === 0 || video.parts[0].cid === 0) return

    const title = partInput?.title ?? computeDefaultTitle(video, videoPart)
    form.setValue('title', title, { shouldValidate: true })
  }, [video, partInput?.title, form, videoPart])

  useEffect(() => {
    const hasAudioQualities = (audioQualities?.length ?? 0) > 0
    if (!videoQualities || videoQualities.length === 0) return

    const videoQuality = partInput?.videoQuality || String(videoQualities[0].id)
    const audioQuality = hasAudioQualities
      ? partInput?.audioQuality || String(audioQualities![0].id)
      : ''

    form.setValue('videoQuality', videoQuality, { shouldValidate: true })
    form.setValue('audioQuality', audioQuality, { shouldValidate: true })

    const needsVideoQuality = !partInput?.videoQuality
    const needsAudioQuality = hasAudioQualities && !partInput?.audioQuality
    if (needsVideoQuality || needsAudioQuality) {
      const title = partInput?.title ?? videoPart.part
      form.trigger().then((isValid) => {
        if (isValid) {
          onValid2(page - 1, title, videoQuality, audioQuality)
        }
      })
    }
  }, [
    videoQualities?.length,
    audioQualities?.length,
    partInput?.videoQuality,
    partInput?.audioQuality,
    partInput?.title,
    form,
    onValid2,
    page,
    videoPart.part,
  ])

  /**
   * Form submission handler that dispatches validated form data to Redux.
   * Called on form submit and blur events for auto-save behavior.
   */
  const onSubmit = useCallback(
    (data: z.infer<typeof schema2>) => {
      onValid2(page - 1, data.title, data.videoQuality, data.audioQuality)
    },
    [onValid2, page, schema2],
  )

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
                {videoPart.thumbnail.url ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <img
                          src={videoPart.thumbnail.url}
                          alt={t('video.thumbnail_alt', {
                            part: videoPart.part,
                          })}
                          className="h-16 w-24 cursor-pointer rounded-lg object-cover md:h-20 md:w-32"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onClick={handleThumbnailClick}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-sm">{t('video.open_in_browser')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                        {selected && <FormMessage />}
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
                {isPreview && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        {t('video.bangumi_preview_badge')}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="whitespace-nowrap">
                      <p className="text-sm">
                        {t('video.bangumi_preview_tooltip')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Options Accordion */}
            <TooltipProvider delayDuration={200}>
              <Accordion
                type="multiple"
                className="w-full"
                value={accordionValue}
                onValueChange={handleAccordionChange}
              >
                <AccordionItem value="options">
                  <AccordionTrigger className="py-2 text-sm">
                    <span className="flex items-center gap-2">
                      {t('video.options')}
                      {summaryLabel && (
                        <span className="text-muted-foreground font-normal">
                          / {summaryLabel}
                        </span>
                      )}
                      {hasFallback && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 text-amber-500">⚠️</span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-sm">
                              {t('video.quality_fallback_tooltip')}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent transition={accordionTransition}>
                    <div className="space-y-4">
                      {/* Unified loading skeleton: shown until all fetches complete */}
                      {qualitiesLoading ||
                      videoQualities === undefined ||
                      subtitlesLoading ? (
                        <>
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-[1.62rem] w-full" />
                          </div>
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-[1.62rem] w-full" />
                          </div>
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-[1.62rem] w-full" />
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Video Quality */}
                          {videoQualities.length === 0 ? (
                            // VIP-only or unavailable episode (bangumi)
                            videoPart.status === 13 ? (
                              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                                <div className="flex items-center gap-2">
                                  <Info className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                                  <p className="font-medium text-amber-900 dark:text-amber-100">
                                    {t('video.bangumi_vip_only')}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
                                <div className="flex items-center gap-2">
                                  <Info className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                                  <p className="font-medium text-red-900 dark:text-red-100">
                                    {t('video.bangumi_no_dash')}
                                  </p>
                                </div>
                              </div>
                            )
                          ) : (
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
                                        <p className="mt-1">
                                          {t('video.quality_note')}
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
                                        idPrefix={`vq-${page}`}
                                        options={Object.entries(
                                          VIDEO_QUALITIES_MAP,
                                        )
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
                                  {selected && <FormMessage />}
                                </FormItem>
                              )}
                            />
                          )}

                          {/* Audio Quality Section */}
                          {(audioQualities?.length ?? 0) > 0 ? (
                            <div>
                              <div className="mb-2 flex items-center gap-1.5">
                                <span className="text-sm font-medium">
                                  {t('video.audio_quality_label')}
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="right"
                                    className="max-w-xs text-xs"
                                  >
                                    <p>
                                      {t('video.audio_quality_description')}
                                    </p>
                                    <p className="mt-1">
                                      {t('video.audio_quality_note')}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <FormField
                                control={form.control}
                                name="audioQuality"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <RadioGroup
                                        value={String(field.value)}
                                        onValueChange={field.onChange}
                                      >
                                        <QualityRadioGroup
                                          idPrefix={`aq-${page}`}
                                          options={AUDIO_QUALITIES_ORDER.map(
                                            (id) => ({
                                              id: String(id),
                                              label: AUDIO_QUALITIES_MAP[id],
                                              isAvailable: isQualityAvailable(
                                                Number(id),
                                                'audio',
                                              ),
                                            }),
                                          )}
                                        />
                                      </RadioGroup>
                                    </FormControl>
                                    {selected && <FormMessage />}
                                  </FormItem>
                                )}
                              />
                            </div>
                          ) : (
                            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950">
                              <div className="flex items-center gap-2">
                                <Info className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                                <p className="text-blue-900 dark:text-blue-100">
                                  {t('video.bangumi_audio_embedded')}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Subtitle Section */}
                          {subtitles.length > 0 && (
                            <div>
                              <div className="mb-2 flex items-center gap-1.5">
                                <span className="text-sm font-medium">
                                  {t('video.subtitle')}
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="text-muted-foreground h-4 w-4 cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="right"
                                    className="max-w-xs text-xs"
                                  >
                                    <p>{t('video.subtitle_description')}</p>
                                    <p className="mt-1">
                                      {t('video.subtitle_note')}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <SubtitleSection
                                subtitles={subtitles}
                                config={
                                  partInput?.subtitle ?? defaultSubtitleConfig
                                }
                                disabled={
                                  disabled ||
                                  isDownloading ||
                                  isPending ||
                                  hasActiveDownloads
                                }
                                page={page}
                                onConfigChange={handleSubtitleConfigChange}
                              />
                            </div>
                          )}
                          {selected && isSubtitleInvalid && (
                            <div className="text-destructive text-xs">
                              {t('video.subtitle_select_required')}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TooltipProvider>

            {/* Duplicate Warning */}
            {selected && isDuplicate && (
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
            hasEmbeddedAudio={
              resolvedQuality
                ? resolvedQuality.audioQuality === null
                : audioQualities !== undefined && audioQualities.length === 0
            }
          />
        )}
      </Form>
    </div>
  )
})

export default VideoPartCard
