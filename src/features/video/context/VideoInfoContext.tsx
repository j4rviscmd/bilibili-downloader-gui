import { isUnauthorizedError } from '@/app/lib/invokeErrorHandler'
import { store, useSelector, type RootState } from '@/app/store'
import {
  useLazyFetchBangumiInfoQuery,
  useLazyFetchVideoInfoQuery,
} from '@/features/video/api/videoApi'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/lib/formSchema'
import { shouldSelectPart } from '@/features/video/lib/partSelection'
import { extractContentId } from '@/features/video/lib/utils'
import { stageExpectations } from '@/features/video/model/downloadProgress'
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
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import {
  collectActivePartKeys,
  enqueueSession,
  type EnqueuePartSpec,
} from '@/shared/queue'
import { toast } from '@/shared/ui/toast'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Input, Video } from '../types'

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
  onValid1: (url: string, opts?: { silent?: boolean }) => Promise<boolean>
  onValid2: (
    index: number,
    title: string,
    videoQuality: string,
    audioQuality?: string,
  ) => void
  /**
   * Canonical video ID of the displayed content ('BV...' for videos,
   * 'av{aid}' for bangumi) — the queue badge/dedup match key. Null when
   * the URL is not (yet) a valid video/bangumi link.
   */
  videoId: string | null
  isForm1Valid: boolean
  isForm2ValidAll: boolean
  duplicateIndices: number[]
  selectedCount: number
  isFetching: boolean
  /** True while a debounced auto-fetch (input pause) is in flight. */
  isSilentFetching: boolean
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

/**
 * Props for {@linkcode VideoInfoProvider}.
 */
type VideoInfoProviderProps = {
  /** React nodes rendered inside the provider's context scope. */
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
  const [isSilentFetching, setIsSilentFetching] = useState(false)
  // Ref-count of in-flight silent fetches: overlapping silent fetches are
  // possible (user pauses on URL A, resumes typing, pauses on URL B before
  // A resolves), so a plain boolean would read false while B still runs.
  const silentFetchCountRef = useRef(0)

  // Track the pending download being processed (singleton ref)
  const processingPendingRef = useRef<{
    bvid: string
    cid: number | null
    page: number
  } | null>(null)

  /**
   * Initializes part input fields based on video metadata.
   *
   * Selection of each part is delegated to {@link shouldSelectPart},
   * which selects only the targeted episode for a bangumi URL, only the
   * requested part for a `?p=N` URL or history/favorites navigation,
   * and otherwise only the first page.
   *
   * @param v - Video object
   */
  const initInputsForVideo = useCallback((v: Video) => {
    const pending = processingPendingRef.current

    const partInputs = v.parts.map((p, index) => ({
      cid: p.cid,
      page: p.page,
      // Why: the previous inline `v.title === p.part` check compared the
      // sanitized title against the raw part name, so title-replacement rules
      // (issue #233) broke the match and filenames came out as "Title Title".
      // The backend now owns the assembly (build_default_part_title in
      // src-tauri/src/utils/sanitize.rs) — FE stays presentation-only.
      // Filename precomputed by the backend (dedup vs video title included)
      title: p.defaultTitle,
      videoQuality: '',
      audioQuality: '',
      selected: shouldSelectPart(p, index, {
        contentType: v.contentType,
        videoEpId: v.epId,
        pending,
      }),
      duration: p.duration,
      thumbnailUrl: p.thumbnail.url,
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
   * With `{ silent: true }` (debounced auto-fetch on input pause) no error
   * toast is shown — the auto path must stay invisible; explicit submit
   * (Enter/blur) reports errors instead.
   *
   * @param url - Video or bangumi URL to validate and fetch
   * @param opts - `silent` suppresses error toasts for the auto-fetch path
   * @returns true when video info was applied to the store
   */
  const onValid1 = useCallback(
    async (url: string, opts?: { silent?: boolean }): Promise<boolean> => {
      const silent = opts?.silent ?? false
      const failToast = (description: string | null | undefined) => {
        if (silent || !description) return
        toast.error(t('video.fetch_info'), {
          duration: 5000,
          description,
        })
      }

      const schema1 = buildVideoFormSchema1(t)
      const result = schema1.safeParse({ url })
      if (!result.success) {
        failToast(result.error.issues[0]?.message)
        store.dispatch(clearPendingDownload())
        return false
      }

      const contentId = extractContentId(url)
      if (!contentId) {
        failToast(t('validation.video.url.invalid'))
        return false
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

      // Note: this also runs for the debounced silent auto-fetch (a mere
      // typing pause), wiping the current part selections before the new
      // video arrives — same behavior as an explicit submit, accepted
      // tradeoff for the auto path. The download queue is NOT cleared
      // (issue #691): queued/background sessions survive navigation.
      store.dispatch(setUrl(url))
      // Clear all selections when navigating to a new video via URL input
      store.dispatch(deselectAll())

      let fetchResult: { data?: Video; error?: unknown }

      if (silent) {
        silentFetchCountRef.current += 1
        setIsSilentFetching(true)
      }
      try {
        if (contentId.type === 'video') {
          fetchResult = await triggerFetch(contentId.id, true)
        } else {
          const epId = parseInt(contentId.epId, 10)
          fetchResult = await triggerFetchBangumi(epId, true)
        }
      } finally {
        if (silent) {
          silentFetchCountRef.current -= 1
          if (silentFetchCountRef.current === 0) setIsSilentFetching(false)
        }
      }

      // Stale guard: the input stays enabled during a silent fetch, so the
      // user may have moved on to another URL — a newer onValid1 has already
      // replaced input.url. Discard this outdated result.
      if (store.getState().input.url !== url) return false

      if (fetchResult.data) {
        const v = fetchResult.data
        store.dispatch(setVideo(v))
        initInputsForVideo(v)
        return true
      }
      if (fetchResult.error) {
        const raw = String(fetchResult.error)
        const key = mapBackendError(raw)
        const description = key ? t(key) : isUnauthorizedError(raw) ? null : raw
        failToast(description)
        logger.error('Failed to fetch content info', raw)
      }
      return false
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

  // Canonical queue-match videoId (same derivation the enqueue path uses).
  // Memoized on the raw inputs so consumers get a stable string.
  const videoId = useMemo(() => {
    const contentId = extractContentId(input.url)
    if (!contentId) return null
    return contentId.type === 'video'
      ? contentId.id
      : `av${video.parts[0]?.aid ?? ''}`
  }, [input.url, video.parts])

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
   * Enqueues the selected parts as one download session (issue #691).
   *
   * Responsibility ends at `enqueueSession`: everything the backend needs
   * is snapshotted into the payload, so later edits to `state.input`
   * (titles, qualities, URL navigation) cannot leak into the enqueued
   * parts. The queue runner (shared/queue/runner.ts, started in main.tsx)
   * drains sessions FIFO — searching/downloading stays possible while
   * earlier sessions run, and this enqueue lands at the queue's tail.
   *
   * Parts whose `videoId`+`cid` are already active
   * (pending/running/cancelling) are auto-excluded; when at least one was
   * excluded, a toast reports the skipped count.
   */
  const download = useCallback(async () => {
    if (!isForm1Valid || !isForm2ValidAll) return
    if (!videoId) return

    const activeKeys = collectActivePartKeys(store.getState().queue)
    const parts: EnqueuePartSpec[] = []
    let skippedCount = 0

    input.partInputs.forEach((pi, idx) => {
      if (!pi.selected) return
      if (activeKeys.has(`${videoId}:${pi.cid}`)) {
        skippedCount += 1
        return
      }
      const title = pi.title.trim()
      parts.push({
        partIndex: idx + 1,
        cid: pi.cid,
        title,
        thumbnailUrl: pi.thumbnailUrl ?? null,
        // Snapshot the stage divisor now (issue #446): reading the lazy
        // quality shape later would break the progress denominator of a
        // background download whose part inputs no longer exist.
        expectedStages: stageExpectations(pi),
        payload: {
          videoId,
          cid: pi.cid,
          filename: title,
          quality: pi.videoQuality ? parseInt(pi.videoQuality, 10) : null,
          audioQuality: pi.audioQuality ? parseInt(pi.audioQuality, 10) : null,
          durationSeconds: pi.duration,
          thumbnailUrl: pi.thumbnailUrl ?? null,
          page: pi.page,
          epId: video.parts[idx]?.epId ?? null,
          subtitle: {
            mode: pi.subtitle.mode,
            selectedLans: pi.subtitle.selectedLans,
            subtitles: (pi.subtitles ?? []).filter((s) =>
              pi.subtitle.selectedLans.includes(s.lan),
            ),
          },
        },
      })
    })

    if (skippedCount > 0) {
      toast.info(t('queue.duplicates_excluded', { count: skippedCount }), {
        duration: 5000,
      })
      logger.info(
        `download: excluded ${skippedCount} already-active part(s) from enqueue`,
      )
    }
    if (parts.length === 0) return

    // Clear previous resolved quality/subtitle info of the displayed video
    // so a re-download's cards start clean. Resolved events for background
    // videos are guarded in ListenerContext and never reach this video.
    store.dispatch(clearResolvedInfo())

    store.dispatch(enqueueSession({ videoId, videoTitle: video.title, parts }))
  }, [isForm1Valid, isForm2ValidAll, videoId, input.partInputs, video, t])

  const value: VideoInfoContextValue = {
    progress,
    video,
    input,
    videoId,
    onValid1,
    onValid2,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    selectedCount,
    isFetching,
    isSilentFetching,
    download,
  }

  return (
    <VideoInfoContext.Provider value={value}>
      {children}
    </VideoInfoContext.Provider>
  )
}
