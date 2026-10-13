import { interceptInvokeError } from '@/app/lib/invokeErrorHandler'
import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/animate-ui/components/radix/accordion'
import { useVideoInfo } from '@/features/video'
import {
  fetchBangumiPartQualities,
  fetchPartQualities,
  fetchSubtitlesForPart,
} from '@/features/video/api/fetchVideoInfo'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import {
  AUDIO_QUALITIES_MAP,
  audioOptionIds,
  VIDEO_QUALITIES_MAP,
  VIDEO_QUALITIES_ORDER,
} from '@/features/video/lib/constants'
import { buildVideoFormSchema2 } from '@/features/video/lib/formSchema'
import { getStatusVisual } from '@/features/video/lib/statusVisual'
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
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { scrollElementWithinScroller } from '@/shared/lib/scroll'
import { cn } from '@/shared/lib/utils'
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
import { ImageOff, Info, Play, RotateCcw } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
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
  /** Opens the shared preview dialog for this part (owned by the page). */
  onThumbnailClick: () => void
}

/** Props for the UnavailableEpisodeWarning component. */
type UnavailableEpisodeWarningProps = {
  /** Episode status code. 13 = VIP-only, others = unavailable. */
  status?: number
}

/**
 * Warning component for unavailable bangumi episodes.
 *
 * Displays a styled alert based on the episode status:
 * - Status 13: VIP-only episode warning (amber color)
 * - Other statuses: General unavailable message (red color)
 *
 * @param props - Component props containing episode status
 * @returns A styled warning alert component
 *
 * @example
 * ```tsx
 * <UnavailableEpisodeWarning status={13} /> // Shows VIP warning
 * <UnavailableEpisodeWarning status={0} />  // Shows unavailable message
 * ```
 */
function UnavailableEpisodeWarning({ status }: UnavailableEpisodeWarningProps) {
  const { t } = useTranslation()

  if (status === 13) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {t('video.bangumi_vip_only')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
        <p className="font-medium text-red-900 dark:text-red-100">
          {t('video.bangumi_no_dash')}
        </p>
      </div>
    </div>
  )
}

/** Props for the QualitiesFetchErrorWarning component. */
type QualitiesFetchErrorWarningProps = {
  /** Raw backend error message (real cause) */
  error: string
}

/**
 * Warning shown when quality fetching itself failed (network, risk control,
 * parse errors) — distinct from genuinely unavailable streams, which render
 * UnavailableEpisodeWarning. Displays the real cause instead of guessing
 * "VIP-only episode" (issue #446).
 */
function QualitiesFetchErrorWarning({
  error,
}: QualitiesFetchErrorWarningProps) {
  const { t } = useTranslation()
  // ERR::* codes map to translation keys; only unmapped messages (e.g. raw
  // parse/network errors) show verbatim as the detail.
  const mappedKey = mapBackendError(error)
  const detail = mappedKey ? t(mappedKey) : error
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
        <p className="font-medium text-red-900 dark:text-red-100">
          {t('video.qualities_fetch_failed', { detail })}
        </p>
      </div>
    </div>
  )
}

/**
 * Video part configuration card component.
 *
 * Displays thumbnail, filename input, quality selectors, and download
 * progress. Changes are auto-saved on blur. Shows a warning for
 * duplicate titles. Wrapped with `React.memo` to skip re-renders when
 * props are shallowly equal.
 *
 * Always full mode (issue #691): the compact swap is abolished. The card
 * carries a status badge resolved by `videoId`+`cid`, so background queue
 * downloads of other videos never light this card up. The form is only
 * disabled while THIS part is active in the queue (pending/running/
 * cancelling) — edits after that point cannot affect the enqueued
 * payload anyway (it was snapshotted at enqueue time).
 */
const VideoPartCard = memo(function VideoPartCard({
  video,
  page,
  isDuplicate,
  onThumbnailClick,
}: Props) {
  const { onValid2, videoId } = useVideoInfo()
  const { t } = useTranslation()
  const disabled = video.parts.length === 0
  const videoPart = video.parts[page - 1]
  const min = Math.floor(videoPart.duration / 60)
  const sec = videoPart.duration % 60

  // Badge/status scope: videoId+cid (latest queue item wins). videoId is
  // null only before a valid URL resolves; the parts list is empty then, so
  // the fallback is inert in practice.
  const downloadStatus = usePartDownloadStatus(videoId ?? '', videoPart.cid)

  const partInput = useSelector(
    (state: RootState) => state.input.partInputs[page - 1],
  )
  const isLoggedIn = useSelector((state: RootState) => state.user.data.isLogin)
  // Why: availability is a bare membership check with no per-option cause,
  // so only login state can distinguish the reasons (issues #584, #713)
  const qualityUnavailableReason = isLoggedIn
    ? t('video.quality_unavailable_logged_in')
    : t('video.quality_requires_vip_or_login')
  const selected = partInput?.selected ?? true

  const dispatch = useDispatch()

  // Track previous queue status to detect the settle transition
  const prevStatusRef = useRef(downloadStatus.status)

  // Deselect exactly when this part's queue item settles as done: the
  // selection belongs to the search form, and a finished part shouldn't be
  // re-enqueued by a later Download click. Scoped to this videoId+cid, so a
  // background session completing never touches this card.
  useEffect(() => {
    const wasStatus = prevStatusRef.current
    prevStatusRef.current = downloadStatus.status
    if (wasStatus !== 'done' && downloadStatus.status === 'done' && selected) {
      dispatch(updatePartSelected({ index: page - 1, selected: false }))
    }
  }, [downloadStatus.status, selected, page, dispatch])

  const subtitle = partInput?.subtitle
  const isSubtitleInvalid =
    subtitle && subtitle.mode !== 'off' && !subtitle.selectedLans?.length
  const subtitles = partInput?.subtitles
  const subtitlesLoading = partInput?.subtitlesLoading ?? false

  const videoQualities = partInput?.videoQualities
  const audioQualities = partInput?.audioQualities
  const qualitiesLoading = partInput?.qualitiesLoading ?? false
  const qualitiesError = partInput?.qualitiesError
  const isPreview = partInput?.isPreview ?? false
  const resolvedQuality = partInput?.resolvedQuality
  const resolvedSubtitle = partInput?.resolvedSubtitle

  // Shared by both the compact card and the full-mode progress block so the
  // two can never disagree about which stages to render.
  // isSilentVideo: no audio track exists at all (issue #446) — drives the
  // no-audio-track banner (vs. the durl embedded-audio one). Before
  // resolution the qualities fetch is the only signal: an empty audio list
  // separates durl (embedded audio) from silent (audioAbsent flag).
  // (The hasEmbeddedAudio counterpart left with the progress detail: stage
  // hiding is now /downloads' concern via the expectedStages snapshot.)
  const audioAbsentFlag = partInput?.audioAbsent ?? false
  const emptyAudioList =
    audioQualities !== undefined && audioQualities.length === 0
  const isSilentVideo = resolvedQuality
    ? resolvedQuality.audioAbsent
    : audioAbsentFlag && emptyAudioList

  /**
   * Builds the summary label for the accordion trigger.
   * Combines quality and subtitle information into a compact display.
   */
  const summaryLabel = useMemo(() => {
    if (!resolvedQuality && !resolvedSubtitle) return null

    const parts: string[] = []

    if (resolvedQuality) {
      // WHY codec is omitted: the codec is chosen by the global
      // videoCodecPriority setting, not per download, and most users cannot
      // act on it — the summary stays focused on the selected quality.
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
   *
   * WHY: codec fallback is excluded. The codec is governed by the global
   * videoCodecPriority setting, and the preferred codec being absent from
   * the manifest leaves no alternative to choose, so warning on it would
   * fire on nearly every AVC-only video with pure noise.
   */
  // Caution: `videoCodecFallback` (sent by the backend
  // download-quality-resolved event and stored via inputSlice
  // setResolvedQuality) is deliberately kept end-to-end despite being
  // unread by the UI today — it may feed a future codec indication.
  // Introduced in PR #460 (a17c8da); removal decided against 2026-09.
  const hasFallback = useMemo(() => {
    if (!resolvedQuality) return false
    return (
      resolvedQuality.videoQualityFallback ||
      resolvedQuality.audioQualityFallback
    )
  }, [resolvedQuality])

  /**
   * Queue status badge (issue #691): resolved by `videoId`+`cid`, so only
   * this part's own queue item can light it up. Rendered only when the part
   * has a queue item — never-downloaded parts show no badge. `data-status`
   * keeps the E2E anchor that the abolished compact row used to carry.
   */
  const queueBadge = downloadStatus.status ? (
    <span
      data-status={downloadStatus.status}
      className="bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          getStatusVisual(downloadStatus.status).dotClass,
        )}
        aria-hidden
      />
      {t(getStatusVisual(downloadStatus.status).labelKey)}
    </span>
  ) : null

  /**
   * Duration overlay on the thumbnail (m:ss, e.g. 2:05). Standard video-card
   * convention: on the image, so the card no longer needs a metadata row.
   */
  // Note: pointer-events-none is load-bearing, not cosmetic: on the thumbnail
  // branch the badge sits on top of the full-inset preview button and would
  // otherwise swallow clicks aimed at that corner.
  const durationBadge = (
    <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white tabular-nums">
      {min}:{String(sec).padStart(2, '0')}
    </span>
  )

  // Shared slot classes for both thumbnail branches. Why explicit size: the
  // grid's thumb track is auto-sized, so a bare h-full/w-full item collapses
  // it to the icon width instead of filling the slot.
  const thumbSlotClass =
    'relative h-20 w-36 self-center [grid-area:thumb] md:h-auto md:max-h-30 md:w-48 md:self-stretch'

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

  // Debounce timer for deferred title validation. Holds the pending
  // timeout so it can be cancelled on blur or unmount.
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel any pending debounced validation. Used on blur (so the
  // form-level onBlur flushes the save once) and on unmount (to avoid
  // updating form state after the component is gone). The null guard
  // also narrows the ref type for clearTimeout.
  const cancelPendingTitleValidation = useCallback(() => {
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current)
      titleDebounceRef.current = null
    }
  }, [])

  // Constraint: Relies on `cancelPendingTitleValidation` staying referentially
  // stable (its useCallback above uses `[]` deps) so cleanup fires only on
  // unmount. Adding deps to that useCallback would re-run this effect on every
  // render, clearing the in-flight timer each keystroke and silently disabling
  // the debounced validation.
  useEffect(() => {
    return cancelPendingTitleValidation
  }, [cancelPendingTitleValidation])

  /**
   * Transition override applied only on initial mount when the accordion is
   * already open (e.g. restored from Redux state). Prevents the animated
   * expand from playing on page load by forcing zero duration.
   */
  const accordionTransition =
    !mountedRef.current && partInput?.accordionOpen
      ? { duration: 0 }
      : undefined

  /** Ref attached to the card root for scroll-into-view on expand. */
  const cardRef = useRef<HTMLDivElement>(null)

  /**
   * Reveals this card by scrolling only its owning page scroller (never
   * outer overflow-hidden boxes — see scrollElementWithinScroller).
   * Uses a timeout to allow the expand animation (350ms) to settle.
   */
  const scrollCardIntoView = useCallback(() => {
    setTimeout(() => {
      if (cardRef.current) {
        scrollElementWithinScroller(cardRef.current, 8)
      }
    }, 400)
  }, [])

  /**
   * Fetches quality options for the current video part.
   */
  const doFetchQualities = useCallback(
    async (partIndex: number, isBangumi: boolean, epId: number | undefined) => {
      try {
        // Regular videos: [vq, aq, audioAbsent]; bangumi: [vq, aq, isPreview]
        // (bangumi manifests always carry audio when downloadable).
        const [vq, aq, third] =
          isBangumi && epId
            ? await fetchBangumiPartQualities(epId, videoPart.cid)
            : await fetchPartQualities(video.bvid, videoPart.cid)
        store.dispatch(
          setPartQualities({
            index: partIndex,
            videoQualities: vq,
            audioQualities: aq,
            // Bangumi's null isPreview normalizes to undefined
            isPreview: isBangumi ? (third ?? undefined) : undefined,
            audioAbsent: !isBangumi && third === true,
          }),
        )
      } catch (e) {
        const message = await interceptInvokeError(store, e)
        if (message) {
          logger.error('Failed to fetch qualities', message)
        }
        store.dispatch(
          setPartQualities({
            index: partIndex,
            videoQualities: [],
            audioQualities: [],
            // Keep the real cause so the card can show why streams are
            // empty instead of the misleading VIP-only guess (issue #446).
            // Unauthorized session expiry already toasted; still mark the
            // card so the banner reflects the fetch failure.
            qualitiesError: message ?? String(e),
          }),
        )
      }
    },
    [video.bvid, videoPart.cid],
  )

  /**
   * Fetches subtitle options for the current video part.
   */
  const doFetchSubtitles = useCallback(
    async (partIndex: number) => {
      try {
        const fetchedSubtitles = await fetchSubtitlesForPart(
          video.bvid,
          videoPart.cid,
        )
        store.dispatch(
          setPartSubtitles({ index: partIndex, subtitles: fetchedSubtitles }),
        )
      } catch (e) {
        const message = await interceptInvokeError(store, e)
        if (message) {
          logger.error('Failed to fetch subtitles', message)
        }
        store.dispatch(setPartSubtitles({ index: partIndex, subtitles: [] }))
      }
    },
    [video.bvid, videoPart.cid],
  )

  /**
   * Handles accordion open/close state changes.
   * Fetches qualities and subtitles in parallel when the accordion is
   * opened for the first time. Scrolls the card top into view on open.
   */
  const handleAccordionChange = useCallback(
    async (value: string[]) => {
      const isOpen = value.includes('options')
      const partIndex = page - 1
      store.dispatch(setAccordionOpen({ index: partIndex, open: isOpen }))

      if (!isOpen) return

      // Scroll card top into view after expand animation (350ms)
      scrollCardIntoView()

      const isBangumi = video.contentType === 'bangumi'
      const epId = videoPart.epId
      const shouldFetchQualities =
        videoQualities === undefined && !qualitiesLoading
      const shouldFetchSubtitles = subtitles === undefined && !subtitlesLoading
      const isVipOnly = isBangumi && !epId

      if (shouldFetchQualities) {
        if (isVipOnly) {
          // VIP-only bangumi without epId - no qualities available
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

      // Fetch data in parallel
      const tasks: Promise<void>[] = []
      if (shouldFetchQualities && !isVipOnly) {
        tasks.push(doFetchQualities(partIndex, isBangumi, epId))
      }
      if (shouldFetchSubtitles) {
        tasks.push(doFetchSubtitles(partIndex))
      }
      await Promise.all(tasks)
    },
    [
      page,
      video.contentType,
      videoPart.epId,
      videoQualities,
      qualitiesLoading,
      subtitles,
      subtitlesLoading,
      doFetchQualities,
      doFetchSubtitles,
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
   * Handles subtitle configuration changes.
   * Dispatches the updated config to Redux store.
   * Scrolls card into view when switching from off to soft/hard mode.
   */
  const handleSubtitleConfigChange = useCallback(
    (config: Parameters<typeof updateSubtitleConfig>[0]['config']) => {
      const prevMode = subtitle?.mode ?? 'off'
      store.dispatch(updateSubtitleConfig({ index: page - 1, config }))
      if (prevMode === 'off' && config.mode !== 'off') {
        scrollCardIntoView()
      }
    },
    [page, subtitle?.mode, scrollCardIntoView],
  )

  const schema2 = useMemo(() => buildVideoFormSchema2(t), [t])

  // Why: defaultTitle is assembled by the backend (build_default_part_title in
  // src-tauri/src/utils/sanitize.rs, honoring omitDuplicatePartTitle). Do not
  // re-derive it here: the removed computeDefaultTitle compared the sanitized
  // title against the raw part name and missed real duplicates.
  // Plain const: defaultValues are only read on mount, and strings have
  // no referential identity for useMemo to preserve.
  const initialTitle = partInput?.title ?? videoPart.defaultTitle

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

    const title = partInput?.title ?? videoPart.defaultTitle
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
      const title = partInput?.title ?? videoPart.defaultTitle
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
    videoPart.defaultTitle,
  ])

  /**
   * Form submission handler that dispatches validated form data to Redux.
   * Called on form submit and blur events for auto-save behavior.
   */
  const onSubmit = useCallback(
    (data: z.infer<typeof schema2>) => {
      onValid2(page - 1, data.title, data.videoQuality, data.audioQuality)
    },
    [onValid2, page],
  )

  // Live title value drives the reset button's disabled state.
  const isDefaultTitle = form.watch('title') === videoPart.defaultTitle

  /**
   * Restores the backend-built default part title and flushes the save
   * immediately (same contract as the debounced auto-save, no blur needed).
   */
  const handleResetTitle = useCallback(() => {
    cancelPendingTitleValidation()
    form.setValue('title', videoPart.defaultTitle, { shouldValidate: true })
    void form.handleSubmit(onSubmit)()
  }, [cancelPendingTitleValidation, form, onSubmit, videoPart.defaultTitle])

  /**
   * Bangumi preview badge for the title row; the tooltip carries the
   * longer paywall-preview explanation.
   */
  const previewBadge = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
          {t('video.bangumi_preview_badge')}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="whitespace-nowrap">
        <p className="text-sm">{t('video.bangumi_preview_tooltip')}</p>
      </TooltipContent>
    </Tooltip>
  )

  /**
   * Reset-to-default title button for the title row. Why the span wrapper
   * inside TooltipTrigger: a disabled button's pointer-events: none would
   * swallow hover, leaving this tooltip (the button's only label)
   * unreachable.
   */
  const resetTitleControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <button
            type="button"
            onClick={handleResetTitle}
            disabled={isDefaultTitle}
            aria-label={t('video.reset_title')}
            className="text-muted-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-6 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" arrow>
        {isDefaultTitle
          ? t('video.reset_title_already_default')
          : t('video.reset_title')}
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div ref={cardRef} className="p-3 md:p-4">
      <Form {...form}>
        {/* The form stays editable while the part is queued/running by
            design (replace semantics): the enqueued payload is a snapshot,
            edits never leak into it, and pressing Download again swaps a
            pending part in place / re-queues a running one. */}
        <fieldset disabled={disabled}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onBlur={form.handleSubmit(onSubmit)}
            className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-3 gap-y-2 [grid-template-areas:'check_thumb_col''acc_acc_acc'] md:[grid-template-areas:'check_thumb_col''check_thumb_acc']"
          >
            {/* Why: minmax(0,1fr) track plus min-w-0 on the col/acc children:
                grid items default to min-width:auto and refuse to shrink
                below their content's width, so without both the card would
                overflow the list column instead of fitting it. */}
            <div className="flex flex-col items-center justify-center gap-2 self-center [grid-area:check] md:max-h-30 md:self-stretch">
              {/* Why in-flow badge + thumb-mirrored sizing (self-stretch
                  with the same max-h-30 cap as the thumbnail): the cell
                  always occupies the thumbnail's box, so the centered
                  badge + checkbox sit at the thumbnail's middle in both
                  accordion states — nothing jumps when options expand. */}
              <span className="text-muted-foreground bg-muted rounded-full px-1.5 text-[10px] leading-4 font-medium tabular-nums">
                P{page}
              </span>
              <Checkbox
                checked={selected}
                onCheckedChange={handleSelectedChange}
                size="lg"
              />
            </div>
            {videoPart.thumbnail.url ? (
              // Why group/thumb + sibling button: same reveal pattern
              // as the video search grid's play overlay
              // (VideoCardGrid) — the scrim + play icon appear on
              // hover/focus-visible, so the control stays hidden
              // until wanted but is keyboard-discoverable.
              <span className={cn('group/thumb', thumbSlotClass)}>
                <img
                  src={videoPart.thumbnail.url}
                  alt={t('video.thumbnail_alt', {
                    part: videoPart.part,
                  })}
                  className="block h-full w-full rounded-lg object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={onThumbnailClick}
                  aria-label={t('videoSearch.previewPlay')}
                  className="focus-visible:ring-ring/50 absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 text-white opacity-0 transition outline-none group-hover/thumb:bg-black/40 group-hover/thumb:opacity-100 focus-visible:bg-black/40 focus-visible:opacity-100 focus-visible:ring-[3px]"
                >
                  <Play
                    className="size-8 fill-current drop-shadow"
                    aria-hidden
                  />
                </button>
                {durationBadge}
              </span>
            ) : (
              <div
                className={cn(
                  'bg-muted flex items-center justify-center rounded-lg',
                  thumbSlotClass,
                )}
              >
                <ImageOff className="text-muted-foreground/50 h-8 w-8" />
                {durationBadge}
              </div>
            )}

            {/* Title Input */}
            <div className="min-w-0 [grid-area:col]">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormLabel className="text-sm font-medium">
                        {t('video.title_label')}
                      </FormLabel>
                      <div className="ml-auto flex items-center gap-2">
                        {resetTitleControl}
                        {isPreview && previewBadge}
                        {queueBadge}
                      </div>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder={t('video.title_placeholder')}
                        className="min-h-[52px] resize-none"
                        rows={3}
                        value={field.value}
                        onChange={(e) => {
                          field.onChange(e.target.value)

                          // Debounce validation so it only fires after
                          // the user pauses typing, avoiding noisy
                          // per-keystroke error flashes. When valid, also
                          // flush the auto-save so the download-ready
                          // state updates without requiring blur.
                          cancelPendingTitleValidation()
                          titleDebounceRef.current = setTimeout(() => {
                            void form.trigger('title').then((isValid) => {
                              if (isValid) {
                                void form.handleSubmit(onSubmit)()
                              }
                            })
                          }, 500)
                        }}
                        onBlur={() => {
                          // Cancel any not-yet-fired debounce timer so the
                          // form-level onBlur flushes the save once. If the
                          // timer already fired, the extra dispatch is
                          // idempotent (same title value).
                          cancelPendingTitleValidation()
                          field.onBlur()
                        }}
                      />
                    </FormControl>
                    {selected && <FormMessage />}
                  </FormItem>
                )}
              />
            </div>

            {/* Options Accordion */}
            <TooltipProvider delayDuration={200}>
              <Accordion
                type="multiple"
                className="w-full min-w-0 [grid-area:acc]"
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
                      (subtitlesLoading && subtitles === undefined) ? (
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
                            qualitiesError ? (
                              <QualitiesFetchErrorWarning
                                error={qualitiesError}
                              />
                            ) : (
                              <UnavailableEpisodeWarning
                                status={videoPart.status ?? 0}
                              />
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
                                        unavailableReason={
                                          qualityUnavailableReason
                                        }
                                        options={VIDEO_QUALITIES_ORDER.map(
                                          (id) => ({
                                            id: String(id),
                                            label:
                                              VIDEO_QUALITIES_MAP[id] ??
                                              String(id),
                                            isAvailable: isQualityAvailable(
                                              id,
                                              'video',
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
                                    <p className="mt-1 whitespace-pre-line">
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
                                          unavailableReason={
                                            qualityUnavailableReason
                                          }
                                          options={audioOptionIds(
                                            audioQualities,
                                          ).map((id) => ({
                                            id: String(id),
                                            label:
                                              AUDIO_QUALITIES_MAP[id] ??
                                              String(id),
                                            isAvailable: isQualityAvailable(
                                              id,
                                              'audio',
                                            ),
                                          }))}
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
                                  {isSilentVideo
                                    ? t('video.no_audio_track')
                                    : t('video.bangumi_audio_embedded')}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Subtitle Section */}
                          {subtitles && subtitles.length > 0 && (
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
                                disabled={disabled}
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
              <div className="text-destructive col-span-full mt-1 text-sm">
                {t('validation.video.title.duplicate')}
              </div>
            )}
          </form>
        </fieldset>

        {/* No per-part progress detail here by design (issue #691): the
            search page's responsibility ends at enqueueing — the badge
            carries the state, the bottom bar the summary, and /downloads
            the stage detail and cancellation. */}
      </Form>
    </div>
  )
})

export default VideoPartCard
