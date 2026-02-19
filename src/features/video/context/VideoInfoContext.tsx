import { type RootState, store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { useLazyFetchVideoInfoQuery } from '@/features/video/api/videoApi'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/lib/formSchema'
import { extractVideoId } from '@/features/video/lib/utils'
import {
  clearPendingDownload,
  initPartInputs,
  setUrl,
  updatePartInputByIndex,
  updatePartSelected,
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
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Input, Video } from '../types'

/**
 * Error code to translation key mapping.
 *
 * Maps backend error codes (ERR::* format) to i18n translation keys for
 * user-facing error messages.
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
}

/**
 * Extracts localized error message from error string.
 *
 * Maps backend error codes to user-facing translation keys. Returns the original
 * error message if no known error code is found. Handles network errors specifically.
 *
 * @param error - The error string returned from the backend
 * @param t - Translation function from react-i18next
 * @returns Localized error message string
 */
function getErrorMessage(error: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (error.includes(code)) return t(key)
  }
  return error.includes('ERR::NETWORK::') ? t('video.network_error') : error
}

/**
 * Context value type for VideoInfoProvider.
 *
 * @property progress - Download progress state from Redux store
 * @property video - Current video information (title, parts, qualities, etc.)
 * @property input - Form input state (URL, part inputs, pending download)
 * @property onValid1 - Validates video URL and fetches video info (Step 1)
 * @property onValid2 - Updates part settings (title, quality) (Step 2)
 * @property isForm1Valid - Whether the URL form is valid
 * @property isForm2ValidAll - Whether all part forms are valid and no duplicates exist
 * @property duplicateIndices - Indices of parts with duplicate titles
 * @property selectedCount - Number of parts selected for download
 * @property isFetching - Whether video info is being fetched
 * @property download - Executes download for selected parts
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
 *
 * Provides access to video data, form inputs, validation status, and download
 * orchestration functions throughout the video feature component tree.
 */
const VideoInfoContext = createContext<VideoInfoContextValue | null>(null)

/**
 * Hook to access the VideoInfoContext.
 * Must be used within a VideoInfoProvider.
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
 * Provider for managing video information and download workflow.
 * Provides video info fetching, part settings management, duplicate detection, and download execution.
 */
export function VideoInfoProvider({ children }: VideoInfoProviderProps) {
  const { t } = useTranslation()
  const progress = useSelector((state) => state.progress)
  const video = useSelector((state) => state.video)
  const input = useSelector((state) => state.input)
  const [triggerFetch, { isFetching }] = useLazyFetchVideoInfoQuery()

  // Track the pending download being processed (singleton ref)
  const processingPendingRef = useRef<{
    bvid: string
    cid: number | null
    page: number
  } | null>(null)

  /**
   * Initializes part input fields based on video metadata.
   */
  const initInputsForVideo = useCallback((v: Video) => {
    const partInputs = v.parts.map((p) => {
      const title = v.title === p.part ? v.title : `${v.title} ${p.part}`
      return {
        cid: p.cid,
        page: p.page,
        title,
        videoQuality: (p.videoQualities[0]?.id ?? 80).toString(),
        audioQuality: (p.audioQualities[0]?.id ?? 30216).toString(),
        selected: true,
        duration: p.duration,
        thumbnailUrl: p.thumbnail.url,
      }
    })
    store.dispatch(initPartInputs(partInputs))
  }, [])

  /**
   * Validates video URL and fetches information (form 1).
   * Uses RTK Query for caching - subsequent requests for the same videoId
   * will be served from cache for 1 hour.
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

      store.dispatch(setUrl(url))
      const id = extractVideoId(url)
      if (id) {
        store.dispatch(clearQueue())

        const fetchResult = await triggerFetch(id, true) // preferCacheValue: use cache if available
        if (fetchResult.data) {
          const v = fetchResult.data
          store.dispatch(setVideo(v))
          initInputsForVideo(v)
        } else if (fetchResult.error) {
          const raw = String(fetchResult.error)
          const description = getErrorMessage(raw, t)
          toast.error(t('video.fetch_info'), {
            duration: 5000,
            description,
          })
          console.error('Failed to fetch video info:', raw)
        }
      }
    },
    [t, initInputsForVideo, triggerFetch],
  )

  /**
   * Updates part settings (title, quality) (form 2).
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
          ...(audioQuality ? { audioQuality } : {}),
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

  const isForm2ValidAll =
    input.partInputs.every(
      (pi) =>
        schema2.safeParse({
          title: pi.title,
          videoQuality: pi.videoQuality,
          audioQuality: pi.audioQuality,
        }).success,
    ) &&
    !hasDuplicates &&
    selectedCount > 0

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
    if (processing?.bvid === bvid && processing.page === page) return

    processingPendingRef.current = { bvid, cid, page }
    onValid1(`https://www.bilibili.com/video/${bvid}?p=${page}`)
  }, [input.pendingDownload, onValid1])

  /**
   * Handles part selection for pending download (after video info is fetched).
   *
   * Once video info is loaded, this effect automatically selects the specific
   * part that was requested from history/favorites. Selection is based on
   * either cid (preferred) or page number as fallback.
   */
  useEffect(() => {
    const processing = processingPendingRef.current
    if (!processing || video.parts.length === 0) return

    const { cid, page } = processing

    // Select only the target part; deselect all others
    // Prefer cid matching for accuracy, fall back to page matching
    input.partInputs.forEach((pi, idx) => {
      const shouldSelect = cid !== null ? pi.cid === cid : pi.page === page
      store.dispatch(updatePartSelected({ index: idx, selected: shouldSelect }))
    })

    // Clear pending state after selection is complete
    store.dispatch(clearPendingDownload())
    processingPendingRef.current = null
  }, [video.parts, input.partInputs])

  /**
   * Executes download for selected video parts.
   */
  const download = useCallback(async () => {
    if (!isForm1Valid || !isForm2ValidAll) return

    const videoId = (extractVideoId(input.url) ?? '').trim()
    if (!videoId) return

    // Extract selected parts with their indices for download processing
    // Type predicate filter ensures non-null items with proper type narrowing
    const selectedParts = input.partInputs
      .map((pi, idx) => (pi.selected ? { pi, idx } : null))
      .filter(
        (item): item is { pi: (typeof input.partInputs)[0]; idx: number } =>
          item !== null,
      )

    // Clear previously completed items for the selected parts to allow re-download
    // This removes finished queue entries so they can be queued again
    for (const { idx } of selectedParts) {
      const completedItem = findCompletedItemForPart(store.getState(), idx + 1)
      if (completedItem) {
        store.dispatch(clearQueueItem(completedItem.downloadId))
      }
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

      const downloadId = `${parentId}-p${idx + 1}`
      try {
        await downloadVideo(
          videoId,
          pi.cid,
          pi.title.trim(),
          parseInt(pi.videoQuality, 10),
          parseInt(pi.audioQuality, 10),
          downloadId,
          parentId,
          pi.duration,
          pi.thumbnailUrl,
          pi.page,
        )
      } catch (e) {
        const raw = String(e)
        if (raw.includes('ERR::CANCELLED')) continue

        const description = getErrorMessage(raw, t)
        toast.error(t('video.download_failed'), {
          duration: Infinity,
          description,
          closeButton: true,
        })
        console.error('Download failed:', raw)
        store.dispatch(setError(description))
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
