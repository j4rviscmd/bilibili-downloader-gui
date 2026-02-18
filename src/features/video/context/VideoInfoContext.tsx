import { type RootState, store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
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
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Input, Video } from '../types'

/**
 * Error code to translation key mapping.
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
 */
function getErrorMessage(error: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (error.includes(code)) return t(key)
  }
  return error.includes('ERR::NETWORK::') ? t('video.network_error') : error
}

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
  const [isFetching, setIsFetching] = useState(false)

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
    const partInputs = v.parts.map((p) => ({
      cid: p.cid,
      page: p.page,
      title: `${v.title} ${p.part}`,
      videoQuality: (p.videoQualities[0]?.id || 80).toString(),
      audioQuality: (p.audioQualities[0]?.id || 30216).toString(),
      selected: true,
      duration: p.duration,
      thumbnailUrl: p.thumbnail.url,
    }))
    store.dispatch(initPartInputs(partInputs))
  }, [])

  /**
   * Validates video URL and fetches information (form 1).
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
        setIsFetching(true)
        try {
          store.dispatch(clearQueue())
          const v = await fetchVideoInfo(id)
          console.log('Fetched video info:', v)
          store.dispatch(setVideo(v))
          initInputsForVideo(v)
        } catch (e) {
          const raw = String(e)
          const description = getErrorMessage(raw, t)
          toast.error(t('video.fetch_info'), {
            duration: 5000,
            description,
          })
          console.error('Failed to fetch video info:', raw)
        } finally {
          setIsFetching(false)
        }
      }
    },
    [t, initInputsForVideo],
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

  // Validation
  const schema1 = buildVideoFormSchema1(t)
  const schema2 = buildVideoFormSchema2(t)
  const isForm1Valid = schema1.safeParse({ url: input.url }).success

  const partValidFlags = input.partInputs.map(
    (pi) =>
      schema2.safeParse({
        title: pi.title,
        videoQuality: pi.videoQuality,
        audioQuality: pi.audioQuality,
      }).success,
  )
  const duplicateIndices = useSelector(selectDuplicateIndices)
  const hasDuplicates = duplicateIndices.length > 0
  const dupToastRef = useRef(false)

  useEffect(() => {
    if (hasDuplicates === dupToastRef.current) return
    dupToastRef.current = hasDuplicates
    if (hasDuplicates)
      toast.error(t('video.duplicate_titles'), { duration: 5000 })
  }, [hasDuplicates, t])

  const selectedCount = input.partInputs.filter((pi) => pi.selected).length

  const isForm2ValidAll =
    partValidFlags.every(Boolean) && !hasDuplicates && selectedCount > 0

  /**
   * Processes pending download from history/favorites.
   */
  useEffect(() => {
    if (!input.pendingDownload) return

    const { bvid, cid, page } = input.pendingDownload

    // Skip if already processing the same pending download
    if (
      processingPendingRef.current &&
      processingPendingRef.current.bvid === bvid &&
      processingPendingRef.current.page === page
    ) {
      return
    }

    // Store pending info for part selection after video info is loaded
    processingPendingRef.current = { bvid, cid, page }

    const url = `https://www.bilibili.com/video/${bvid}?p=${page}`
    onValid1(url)
  }, [input.pendingDownload, onValid1])

  /**
   * Handles part selection for pending download (after video info is fetched).
   */
  useEffect(() => {
    if (!processingPendingRef.current || video.parts.length === 0) return

    const { cid, page } = processingPendingRef.current

    // Deselect all parts first, then select only the target part
    input.partInputs.forEach((pi, idx) => {
      const shouldSelect = cid !== null ? pi.cid === cid : pi.page === page
      store.dispatch(updatePartSelected({ index: idx, selected: shouldSelect }))
    })

    // Clear pending download and processing state
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

    const selectedParts = input.partInputs.flatMap((pi, idx) =>
      pi.selected ? [{ pi, idx }] : [],
    )

    for (const { idx } of selectedParts) {
      const completedItem = findCompletedItemForPart(
        store.getState(),
        idx + 1,
      )
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

    // Download each part sequentially, checking selection before each download
    for (const { pi, idx } of selectedParts) {
      // Check if part is still selected (user may have cancelled while waiting)
      const currentPartInput = store.getState().input.partInputs[idx]
      if (!currentPartInput?.selected) {
        continue // Skip this part if deselected
      }

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
        // Skip error handling for cancelled downloads - continue to next
        if (raw.includes('ERR::CANCELLED')) {
          continue
        }
        const description = getErrorMessage(raw, t)
        toast.error(t('video.download_failed'), {
          duration: Infinity,
          description,
          closeButton: true,
        })
        console.error('Download failed:', raw)
        store.dispatch(setError(description))
        break // Stop on non-cancellation errors
      }
    }

    // Clean up parent if all downloads completed or were cancelled
    const finalChildren = store.getState().queue.filter(
      (i) => i.parentId === parentId,
    )
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
