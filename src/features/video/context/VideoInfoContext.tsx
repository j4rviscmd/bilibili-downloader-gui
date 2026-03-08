import { isUnauthorizedError } from '@/app/lib/invokeErrorHandler'
import { type RootState, store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import {
  useLazyFetchBangumiInfoQuery,
  useLazyFetchVideoInfoQuery,
} from '@/features/video/api/videoApi'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/lib/formSchema'
import { extractContentId } from '@/features/video/lib/utils'
import {
  clearPendingDownload,
  clearResolvedInfo,
  deselectAll,
  initPartInputs,
  setUrl,
  updatePartInputByIndex,
} from '@/features/video/model/inputSlice'
import { selectDuplicateIndices } from '@/features/video/model/selectors'
import { setVideo } from '@/features/video/model/videoSlice'
import { setError } from '@/shared/downloadStatus/downloadStatusSlice'
import {
  clearQueue,
  clearQueueItem,
  enqueue,
  findCompletedItemForPart,
} from '@/shared/queue/queueSlice'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Input, Video } from '../types'

/**
 * Maps backend error codes to i18n translation keys.
 *
 * Backend returns error strings containing error codes like "ERR::VIDEO_NOT_FOUND".
 * This constant maps those codes to translation keys for localized user-facing messages.
 */
const ERROR_MAP: Record<string, string> = {
  'ERR::VIDEO_NOT_FOUND': 'video.video_not_found',
  'ERR::COOKIE_MISSING': 'video.cookie_missing',
  'ERR::API_ERROR': 'video.api_error',
  'ERR::FILE_EXISTS': 'video.file_exists',
  'ERR::DISK_FULL': 'video.disk_full',
  'ERR::MERGE_FAILED': 'video.merge_failed',
  'ERR::QUALITY_NOT_FOUND': 'video.quality_not_found',
  'ERR::RATE_LIMITED': 'video.rate_limited',
  // Bangumi error codes
  'ERR::BANGUMI_NOT_FOUND': 'video.bangumi_not_found',
  'ERR::BANGUMI_VIP_ONLY': 'video.bangumi_vip_only',
  'ERR::BANGUMI_REGION_RESTRICTED': 'video.bangumi_region_restricted',
  'ERR::BANGUMI_COPYRIGHT_RESTRICTED': 'video.bangumi_copyright_restricted',
  'ERR::BANGUMI_ACCESS_DENIED': 'video.bangumi_access_denied',
  'ERR::BANGUMI_NO_DASH': 'video.bangumi_no_dash',
  'ERR::BANGUMI_DURL_NOT_SUPPORTED': 'video.bangumi_durl_not_supported',
}

/**
 * Extracts localized error message from error string.
 *
 * Maps backend error codes to user-facing translation keys. Returns the original
 * error message if no known error code is found. Handles network errors specifically.
 *
 * @param error - The raw error string from the backend
 * @param t - Translation function for localized error messages
 * @returns Localized error message string, or null if already handled
 *
 * @example
 * ```typescript
 * const msg = getErrorMessage('ERR::VIDEO_NOT_FOUND', t);
 * // Returns localized "Video not found" message
 * ```
 */
function getErrorMessage(
  error: string,
  t: (key: string) => string,
): string | null {
  // ERR::UNAUTHORIZED is handled by tauriBaseQuery/interceptInvokeError
  if (isUnauthorizedError(error)) return null

  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (error.includes(code)) return t(key)
  }
  return error.includes('ERR::NETWORK::') ? t('video.network_error') : error
}

/**
 * Extracts the 'p' query parameter from a URL.
 *
 * Used to determine which video part to select when a specific
 * part URL is provided (e.g., https://bilibili.com/video/BVxxx?p=5).
 *
 * @param url - The video URL to parse
 * @returns The page number if valid (1-indexed), null otherwise
 *
 * @example
 * ```typescript
 * extractPageFromUrl('https://bilibili.com/video/BVxxx?p=3'); // Returns 3
 * extractPageFromUrl('https://bilibili.com/video/BVxxx');    // Returns null
 * ```
 */
function extractPageFromUrl(url: string): number | null {
  try {
    const pParam = new URL(url).searchParams.get('p')
    if (!pParam) return null
    const parsed = parseInt(pParam, 10)
    return !isNaN(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

/**
 * Context value type for VideoInfoProvider.
 */
export type VideoInfoContextValue = {
  progress: RootState['progress']
  video: Video
  input: Input
  onValid1: (url: string) => Promise<void>
  onValid2: (
    index: number,
    title: string,
    videoQuality: string,
    audioQuality?: string,
  ) => void
  isForm1Valid: boolean
  isForm2ValidAll: boolean
  duplicateIndices: number[]
  selectedCount: number
  isFetching: boolean
  download: () => Promise<void>
}

/**
 * React context for managing video information and download workflow state.
 */
const VideoInfoContext = createContext<VideoInfoContextValue | null>(null)

/**
 * Hook to access the VideoInfoContext.
 * Must be used within a VideoInfoProvider.
 *
 * @throws {Error} When used outside VideoInfoProvider
 */
export function useVideoInfo(): VideoInfoContextValue {
  const context = useContext(VideoInfoContext)
  if (!context) {
    throw new Error('useVideoInfo must be used within a VideoInfoProvider')
  }
  return context
}

type VideoInfoProviderProps = {
  children: React.ReactNode
}

/**
 * Provider component for managing video information and download workflow.
 *
 * This provider orchestrates the entire video download process including:
 * - Video/bangumi info fetching with RTK Query caching
 * - Part input state management and validation
 * - Duplicate title detection (affected by autoRenameDuplicates setting)
 * - Download queue management and execution
 * - Pending download processing from history/favorites navigation
 *
 * The provider uses a singleton ref pattern to prevent re-processing
 * the same pending download multiple times during state transitions.
 *
 * @param props - Component props containing children to render
 *
 * @example
 * ```tsx
 * <VideoInfoProvider>
 *   <YourVideoDownloadUI />
 * </VideoInfoProvider>
 * ```
 */
export function VideoInfoProvider({ children }: VideoInfoProviderProps) {
  const { t } = useTranslation()
  const progress = useSelector((state) => state.progress)
  const video = useSelector((state) => state.video)
  const input = useSelector((state) => state.input)
  const [triggerFetch, { isFetching: isFetchingVideo }] =
    useLazyFetchVideoInfoQuery()
  const [triggerFetchBangumi, { isFetching: isFetchingBangumi }] =
    useLazyFetchBangumiInfoQuery()
  const isFetching = isFetchingVideo || isFetchingBangumi

  // Track the pending download being processed (singleton ref)
  const processingPendingRef = useRef<{
    bvid: string
    cid: number | null
    page: number
  } | null>(null)

  /**
   * Initializes part input fields based on video metadata.
   *
   * When a pending download exists (from history/favorites), only the
   * target part is marked as selected. This prevents a race condition
   * where all parts would briefly be selected, triggering duplicate
   * title detection before the selection effect could run.
   *
   * @param v - Video object
   */
  const initInputsForVideo = useCallback((v: Video) => {
    const pending = processingPendingRef.current

    const isSelected = (p: (typeof v.parts)[0]) =>
      !pending ||
      (pending.cid !== null ? p.cid === pending.cid : p.page === pending.page)

    const partInputs = v.parts.map((p) => ({
      cid: p.cid,
      page: p.page,
      title:
        v.title === p.part
          ? v.title
          : `${v.title} ${p.sanitizedPart ?? p.part}`,
      videoQuality: '',
      audioQuality: '',
      selected: isSelected(p),
      duration: p.duration,
      thumbnailUrl: p.thumbnail.url,
      subtitles: [],
      subtitlesLoading: false,
      qualitiesLoading: false,
    }))

    store.dispatch(initPartInputs(partInputs))

    if (pending) {
      store.dispatch(clearPendingDownload())
      processingPendingRef.current = null
    }
  }, [])

  /**
   * Validates video/bangumi URL and fetches information (form 1).
   * Uses RTK Query for caching - subsequent requests for the same videoId/epId
   * will be served from cache for 1 hour.
   *
   * @param url - Video or bangumi URL to validate and fetch
   */
  const onValid1 = useCallback(
    async (url: string) => {
      const schema1 = buildVideoFormSchema1(t)
      const result = schema1.safeParse({ url })
      if (!result.success) {
        const message = result.error.issues[0]?.message
        toast.error(t('video.fetch_info'), {
          duration: 5000,
          description: message,
        })
        store.dispatch(clearPendingDownload())
        return
      }

      const contentId = extractContentId(url)
      if (!contentId) {
        toast.error(t('video.fetch_info'), {
          duration: 5000,
          description: t('validation.video.url.invalid'),
        })
        return
      }

      // Extract p parameter from URL for part selection
      const pageFromUrl = extractPageFromUrl(url)

      // Set processingPendingRef before initInputsForVideo is called
      // This ensures only the p-specified part is selected
      if (
        pageFromUrl &&
        !processingPendingRef.current &&
        contentId.type === 'video'
      ) {
        processingPendingRef.current = {
          bvid: contentId.id,
          cid: null,
          page: pageFromUrl,
        }
      }

      store.dispatch(setUrl(url))
      // Clear all selections when navigating to a new video via URL input
      store.dispatch(deselectAll())
      store.dispatch(clearQueue())

      let fetchResult: { data?: Video; error?: unknown }

      if (contentId.type === 'video') {
        fetchResult = await triggerFetch(contentId.id, true)
      } else {
        const epId = parseInt(contentId.epId, 10)
        fetchResult = await triggerFetchBangumi(epId, true)
      }

      if (fetchResult.data) {
        const v = fetchResult.data
        store.dispatch(setVideo(v))
        initInputsForVideo(v)
      } else if (fetchResult.error) {
        const raw = String(fetchResult.error)
        const description = getErrorMessage(raw, t)
        if (description) {
          toast.error(t('video.fetch_info'), {
            duration: 5000,
            description,
          })
        }
        console.error('Failed to fetch content info:', raw)
      }
    },
    [t, initInputsForVideo, triggerFetch, triggerFetchBangumi],
  )

  /**
   * Updates part settings (title, quality) (form 2).
   *
   * @param index - Index of the part to update
   * @param title - New title
   * @param videoQuality - Video quality ID
   * @param audioQuality - Audio quality ID (optional)
   */
  const onValid2 = useCallback(
    (
      index: number,
      title: string,
      videoQuality: string,
      audioQuality?: string,
    ) => {
      store.dispatch(
        updatePartInputByIndex({
          index,
          title,
          videoQuality,
          ...(audioQuality !== undefined && { audioQuality }),
        }),
      )
    },
    [],
  )

  const schema1 = buildVideoFormSchema1(t)
  const schema2 = buildVideoFormSchema2(t)
  const isForm1Valid = schema1.safeParse({ url: input.url }).success

  const duplicateIndices = useSelector(selectDuplicateIndices)
  const hasDuplicates = duplicateIndices.length > 0
  const dupToastRef = useRef(false)

  useEffect(() => {
    if (hasDuplicates === dupToastRef.current) return
    dupToastRef.current = hasDuplicates
    if (hasDuplicates) {
      toast.error(t('video.duplicate_titles'), { duration: 5000 })
    }
  }, [hasDuplicates, t])

  const selectedCount = input.partInputs.filter((pi) => pi.selected).length

  const isForm2ValidAll = useMemo(() => {
    if (!selectedCount || hasDuplicates) return false
    return input.partInputs
      .filter((pi) => pi.selected)
      .every((pi) => {
        const valid = schema2.safeParse({
          title: pi.title,
          videoQuality: pi.videoQuality,
          audioQuality: pi.audioQuality,
        }).success
        const subtitleOk =
          pi.subtitle?.mode === 'off' ||
          (pi.subtitle?.selectedLans?.length ?? 0) > 0
        return valid && subtitleOk
      })
  }, [selectedCount, hasDuplicates, input.partInputs, schema2])

  /**
   * Processes pending download from history/favorites.
   *
   * When a user initiates a download from history or favorites, a pendingDownload
   * is set in the input state. This effect triggers the video info fetch for
   * that video. The ref prevents re-processing the same pending download.
   */
  useEffect(() => {
    const pending = input.pendingDownload
    if (!pending) return

    const { bvid, cid, page } = pending
    const processing = processingPendingRef.current

    // Skip if already processing this exact video/part
    if (processing?.bvid === bvid && processing.page === page) {
      return
    }

    processingPendingRef.current = { bvid, cid, page }
    onValid1(`https://www.bilibili.com/video/${bvid}?p=${page}`)
  }, [input.pendingDownload, onValid1])

  /**
   * Executes download for selected video/bangumi parts.
   *
   * Starts download process for each selected part, creating queue entries.
   * Shows appropriate toast notifications on errors.
   */
  const download = useCallback(async () => {
    if (!isForm1Valid || !isForm2ValidAll) return

    const contentId = extractContentId(input.url)
    if (!contentId) return

    const videoId =
      contentId.type === 'video'
        ? contentId.id
        : `av${video.parts[0]?.aid ?? ''}`

    // Extract selected parts with their indices for download processing
    const selectedParts = input.partInputs
      .map((pi, idx) => (pi.selected ? { pi, idx } : null))
      .filter(
        (
          item,
        ): item is { pi: (typeof input.partInputs)[number]; idx: number } =>
          item !== null,
      )

    // Clear previous resolved quality/subtitle info before starting new download
    store.dispatch(clearResolvedInfo())

    // Clear previously completed items for the selected parts to allow re-download
    for (const { idx } of selectedParts) {
      const completedItem = findCompletedItemForPart(store.getState(), idx + 1)
      if (completedItem)
        store.dispatch(clearQueueItem(completedItem.downloadId))
    }

    const parentId = `${videoId}-${Date.now()}`
    store.dispatch(
      enqueue({
        downloadId: parentId,
        filename: video.title,
        status: 'pending',
      }),
    )

    for (const { pi, idx } of selectedParts) {
      const currentPartInput = store.getState().input.partInputs[idx]
      if (!currentPartInput?.selected) continue

      // Get ep_id for bangumi content
      const epId = video.parts[idx]?.epId

      const downloadId = `${parentId}-p${idx + 1}`
      try {
        await downloadVideo(
          videoId,
          pi.cid,
          pi.title.trim(),
          pi.videoQuality ? parseInt(pi.videoQuality, 10) : null,
          pi.audioQuality ? parseInt(pi.audioQuality, 10) : null,
          downloadId,
          parentId,
          pi.duration,
          pi.thumbnailUrl,
          pi.page,
          pi.subtitle,
          epId,
        )
      } catch (e) {
        const raw = String(e)
        if (raw.includes('ERR::CANCELLED')) continue

        const description = getErrorMessage(raw, t)
        if (description) {
          toast.error(t('video.download_failed'), {
            duration: Infinity,
            description,
            closeButton: true,
          })
          store.dispatch(setError(description))
        }
        console.error('Download failed:', raw)
        break
      }
    }

    const finalChildren = store
      .getState()
      .queue.filter((i) => i.parentId === parentId)
    if (finalChildren.length === 0) {
      store.dispatch(clearQueueItem(parentId))
    }
  }, [
    isForm1Valid,
    isForm2ValidAll,
    input.url,
    input.partInputs,
    video.title,
    t,
  ])

  const value: VideoInfoContextValue = {
    progress,
    video,
    input,
    onValid1,
    onValid2,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    selectedCount,
    isFetching,
    download,
  }

  return (
    <VideoInfoContext.Provider value={value}>
      {children}
    </VideoInfoContext.Provider>
  )
}
