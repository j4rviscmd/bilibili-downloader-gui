import { store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/lib/formSchema'
import {
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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
}

/**
 * Extracts localized error message from error string.
 */
function getErrorMessage(error: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (error.includes(code)) {
      return t(key)
    }
  }
  if (error.includes('ERR::NETWORK::')) {
    return t('video.network_error')
  }
  return error
}

/**
 * Extracts the Bilibili video ID from a URL.
 *
 * @param url - The Bilibili video URL.
 * @returns The video ID (e.g., 'BV1234567890') or null if not found.
 *
 * @example
 * ```typescript
 * extractId('https://www.bilibili.com/video/BV1xx411c7XD')
 * // Returns: 'BV1xx411c7XD'
 * ```
 */
const extractId = (url: string) => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

/**
 * Custom hook for managing video information and download workflow.
 *
 * Handles video URL submission, fetching video metadata from Bilibili,
 * multi-part video selection, quality settings, validation, and download
 * orchestration. Also manages error handling with i18n error messages.
 *
 * @returns An object containing video state, validation status, and
 * action methods.
 *
 * @example
 * ```typescript
 * const {
 *   video,
 *   input,
 *   onValid1,
 *   onValid2,
 *   isForm1Valid,
 *   isForm2ValidAll,
 *   download,
 *   isFetching
 * } = useVideoInfo()
 *
 * // Step 1: Submit video URL
 * await onValid1('https://www.bilibili.com/video/BV1xx411c7XD')
 *
 * // Step 2: Update part settings
 * onValid2(0, 'Custom Title', '80', '30216')
 *
 * // Step 3: Start download
 * await download()
 * ```
 */
export const useVideoInfo = () => {
  const { t } = useTranslation()
  const progress = useSelector((state) => state.progress)
  const video = useSelector((state) => state.video)
  const input = useSelector((state) => state.input)
  const [isFetching, setIsFetching] = useState(false)

  /**
   * Initializes part input fields based on fetched video metadata.
   *
   * Creates input entries for each video part with default quality
   * selections and marks all parts as selected.
   *
   * @param v - The video metadata object.
   */
  const initInputsForVideo = (v: typeof video) => {
    const partInputs = v.parts.map((p) => ({
      cid: p.cid,
      page: p.page,
      title: `${v.title} ${p.part}`,
      videoQuality: (p.videoQualities[0]?.id || 80).toString(),
      audioQuality: (p.audioQualities[0]?.id || 30216).toString(),
      selected: true,
    }))
    store.dispatch(initPartInputs(partInputs))
  }

  /**
   * Handles validation and update of video part settings (Form 2).
   *
   * Updates a specific part's title, video quality, and audio quality.
   *
   * @param index - The part index.
   * @param title - The custom filename for this part.
   * @param videoQuality - The selected video quality ID as a string.
   * @param audioQuality - The selected audio quality ID as a string
   * (optional).
   */
  const onValid2 = (
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
  }

  /**
   * Handles validation and submission of the video URL (Form 1).
   *
   * Extracts the video ID from the URL, fetches metadata from Bilibili,
   * and initializes part inputs. Clears the queue before fetching new video
   * info to prevent showing stale completion status from previous downloads.
   * Sets the fetching state during the operation.
   *
   * @param url - The Bilibili video URL.
   */
  const onValid1 = async (url: string) => {
    store.dispatch(setUrl(url))
    const id = extractId(url)
    if (id) {
      setIsFetching(true)
      try {
        // Clear queue before fetching new video to prevent stale UI states
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
  }

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
  // Toast throttle local to this hook instance
  const dupToastRef = useRef(false)
  useEffect(() => {
    if (hasDuplicates && !dupToastRef.current) {
      toast.error(t('video.duplicate_titles'), { duration: 5000 })
      dupToastRef.current = true
    } else if (!hasDuplicates && dupToastRef.current) {
      dupToastRef.current = false
    }
  }, [hasDuplicates, t])
  // 選択されたパートの数をカウント
  const selectedCount = input.partInputs.filter((pi) => pi.selected).length

  const isForm2ValidAll =
    input.partInputs.length > 0 &&
    partValidFlags.every((f) => f) &&
    !hasDuplicates &&
    selectedCount > 0

  /**
   * Initiates the download process for selected video parts.
   *
   * Validates both forms, generates a unique parent download ID,
   * enqueues the download, and sequentially downloads all selected parts.
   * Handles various error codes from the backend (e.g., ERR::FILE_EXISTS,
   * ERR::DISK_FULL, ERR::MERGE_FAILED) and displays localized error
   * messages.
   *
   * Note: Downloads are processed sequentially to maintain order and avoid
   * overwhelming system resources.
   *
   * @throws Displays toast error notification on failure.
   */
  const download = async () => {
    try {
      if (!isForm1Valid || !isForm2ValidAll) return
      const videoId = (extractId(input.url) ?? '').trim()
      if (!videoId) return

      // Clear completed items for selected parts before starting new download
      const state = store.getState()
      const selectedParts = input.partInputs
        .map((pi, idx) => ({ pi, idx }))
        .filter(({ pi }) => pi.selected)

      for (const { idx } of selectedParts) {
        const completedItem = findCompletedItemForPart(state, idx + 1)
        if (completedItem) {
          store.dispatch(clearQueueItem(completedItem.downloadId))
        }
      }

      // Parent ID
      const parentId = `${videoId}-${Date.now()}`
      // Analytics: record click
      // NOTE: GA4 Analytics は無効化されています
      // await invoke<void>('record_download_click', { downloadId: parentId })
      // Enqueue parent (placeholder filename = video.title)
      store.dispatch(
        enqueue({
          downloadId: parentId,
          filename: video.title,
          status: 'pending',
        }),
      )
      // Child downloads: sequential order by selected parts only
      for (let i = 0; i < selectedParts.length; i++) {
        const { pi, idx } = selectedParts[i]
        await downloadVideo(
          videoId,
          pi.cid,
          pi.title.trim(),
          parseInt(pi.videoQuality, 10),
          parseInt(pi.audioQuality, 10),
          `${parentId}-p${idx + 1}`,
          parentId,
        )
      }
    } catch (e) {
      const raw = String(e)
      const description = getErrorMessage(raw, t)
      toast.error(t('video.download_failed'), {
        duration: Infinity,
        description,
        closeButton: true,
      })
      console.error('Download failed:', raw)
      store.dispatch(setError(description))
    }
  }

  return {
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
}
