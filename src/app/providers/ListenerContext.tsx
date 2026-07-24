import { store } from '@/app/store'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { addEntry } from '@/features/history/model/historySlice'
import {
  closeAllAccordions,
  setResolvedQuality,
  setResolvedSubtitle,
} from '@/features/video/model/inputSlice'
import type {
  QualityResolvedPayload,
  SubtitleResolvedPayload,
} from '@/features/video/types'
import i18n from '@/i18n'
import type { Progress } from '@/shared/progress'
import {
  clearProgressByDownloadId,
  setProgress,
  setRetrying,
} from '@/shared/progress/progressSlice'
import { updateQueueStatus } from '@/shared/queue/queueSlice'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

interface DownloadCancelledPayload {
  downloadId: string
}

/**
 * Payload for the `download-retrying` event.
 *
 * Emitted by `retry_download` in the Rust backend when a retry attempt
 * starts (isRetrying: true) or completes (isRetrying: false). Drives the
 * `setRetrying` Redux action to hide transfer rate display during retries.
 */
interface DownloadRetryingPayload {
  /** Unique identifier for this download operation */
  downloadId: string
  /** Stage identifier ("audio" or "video"). When undefined, applies to all stages */
  stage?: string
  /** Whether the download is currently retrying */
  isRetrying: boolean
}

/**
 * Payload for the `download-subtitle-warning` event.
 *
 * Emitted by the backend when one or more subtitle downloads fail after
 * all retry attempts. Contains the display names of the languages that
 * could not be downloaded, used to show a warning toast to the user.
 */
interface SubtitleWarningPayload {
  /** Display names of subtitle languages that failed to download (e.g., "日本語", "Español") */
  failedLanguages: string[]
}

/**
 * React Context for managing Tauri event listeners.
 *
 * This context enables automatic setup of event listeners for progress
 * events emitted from the Rust backend.
 */
const ListenerContext = createContext<boolean>(false)

/**
 * Provider component for Tauri event listeners.
 *
 * Sets up listeners for events emitted from the Tauri Rust backend:
 * - `progress` - Download progress updates dispatched to Redux state,
 *   with toast notifications for quality fallback warnings
 * - `history:entry_added` - New history entries dispatched to Redux state
 * - `download_cancelled` - Clears queue items and progress, shows info toast
 * - `download-quality-resolved` - Updates resolved video/audio quality in state
 * - `download-subtitle-resolved` - Updates resolved subtitle mode and labels in state
 * - `download-subtitle-warning` - Shows a warning toast when subtitle downloads fail
 *
 * All listeners are automatically cleaned up when the component unmounts.
 *
 * @param props - Component props
 * @param props.children - Child components to be wrapped by this provider
 *
 * @example
 * ```tsx
 * <ListenerProvider>
 *   <App />
 * </ListenerProvider>
 * ```
 */
export const ListenerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined
    let unlistenHistory: UnlistenFn | undefined
    let unlistenCancelled: UnlistenFn | undefined
    let unlistenQualityResolved: UnlistenFn | undefined
    let unlistenSubtitleResolved: UnlistenFn | undefined
    let unlistenSubtitleWarning: UnlistenFn | undefined
    let unlistenRetrying: UnlistenFn | undefined

    const setupListeners = async (): Promise<void> => {
      // Setup progress event listener
      unlistenProgress = await listen('progress', (event) => {
        const payload = event.payload as Progress
        const { stage, downloadId } = payload
        store.dispatch(setProgress(payload))

        // Update queue status based on progress stage
        const isDownloadStage =
          stage && ['audio', 'video', 'merge'].includes(stage)
        if (stage === 'complete') {
          // Mark as done - keep in queue so completion actions remain visible
          store.dispatch(updateQueueStatus({ downloadId, status: 'done' }))
        } else if (isDownloadStage) {
          // Mark as running when download stages start
          store.dispatch(updateQueueStatus({ downloadId, status: 'running' }))
        }

        // Why: the backend emits the `merge-fallback` stage (Emits::set_stage
        //   in merge_avs, src-tauri/src/handlers/ffmpeg.rs) only when the
        //   fast/lossless `-c:a copy` path fails and it falls back to AAC
        //   re-encoding. Surfacing it as a toast keeps the user informed that
        //   this merge will run slower than the usual stream-copy fast path
        //   (Issue #492).
        // Note: this is the merge *codec* fallback, distinct from the *quality*
        //   fallback handled below (warn-*-quality-fallback), which is about
        //   the CDN serving a lower-than-requested quality. Keep this stage
        //   string in sync with the Rust emitter if it is renamed.
        // Show toast for audio fallback during merge
        if (stage === 'merge-fallback') {
          toast.info(i18n.t('video.audio_merge_fallback'), {
            duration: 6000,
          })
        }

        // Show toast for quality fallback warnings
        const isFallbackWarning =
          stage === 'warn-video-quality-fallback' ||
          stage === 'warn-audio-quality-fallback'
        if (isFallbackWarning) {
          const key =
            stage === 'warn-video-quality-fallback'
              ? 'video.video_quality_fallback'
              : 'video.audio_quality_fallback'
          toast.warning(i18n.t(key, { from: 'selected', to: 'fallback' }), {
            duration: 6000,
          })
        }
      })

      // Setup history entry added event listener
      unlistenHistory = await listen('history:entry_added', (event) => {
        const entry = event.payload as HistoryEntry
        store.dispatch(addEntry(entry))
      })

      // Setup download cancelled event listener
      unlistenCancelled = await listen<DownloadCancelledPayload>(
        'download_cancelled',
        (event) => {
          const { downloadId } = event.payload
          // Don't wipe a finished download if the cancel arrived just after
          // completion (race with download_video's remove). done/error are
          // kept so their queue state (used by re-download checks) survives.
          const item = store
            .getState()
            .queue.find((q) => q.downloadId === downloadId)
          if (item && (item.status === 'done' || item.status === 'error')) {
            return
          }
          // @why: Keep the row as 'cancelled' instead of removing it. Silently
          //   deleting the item hides which part the user cancelled, leaving the
          //   status dialog and part card unclear about what was cancelled. The
          //   cancelled row stays visible with a strikethrough.
          store.dispatch(updateQueueStatus({ downloadId, status: 'cancelled' }))
          // Clear progress entries for this download
          store.dispatch(clearProgressByDownloadId(downloadId))
          // Show toast notification
          toast.info(i18n.t('video.download_cancelled'))
        },
      )

      // Setup quality resolved event listener
      unlistenQualityResolved = await listen<QualityResolvedPayload>(
        'download-quality-resolved',
        (event) => {
          store.dispatch(setResolvedQuality(event.payload))
          store.dispatch(closeAllAccordions())
        },
      )

      // Setup subtitle resolved event listener
      unlistenSubtitleResolved = await listen<SubtitleResolvedPayload>(
        'download-subtitle-resolved',
        (event) => {
          const { page, subtitleMode, subtitleLanguageLabels } = event.payload
          store.dispatch(
            setResolvedSubtitle({
              page,
              subtitleMode,
              subtitleLanguageLabels,
            }),
          )
        },
      )

      // Setup subtitle warning event listener
      unlistenSubtitleWarning = await listen<SubtitleWarningPayload>(
        'download-subtitle-warning',
        (event) => {
          const { failedLanguages } = event.payload
          const langList = failedLanguages.join('・')
          toast.warning(
            i18n.t('video.subtitle_download_failed', {
              languages: langList,
            }),
            { duration: 6000 },
          )
        },
      )

      // Setup download retrying event listener
      // Updates isRetrying flag on matching progress entries to hide
      // transfer rate display during CDN rotation / full retry.
      unlistenRetrying = await listen<DownloadRetryingPayload>(
        'download-retrying',
        (event) => {
          store.dispatch(setRetrying(event.payload))
        },
      )
    }

    setupListeners()

    return () => {
      unlistenProgress?.()
      unlistenHistory?.()
      unlistenCancelled?.()
      unlistenQualityResolved?.()
      unlistenSubtitleResolved?.()
      unlistenSubtitleWarning?.()
      unlistenRetrying?.()
    }
  }, [])
  return (
    <ListenerContext.Provider value={true}>{children}</ListenerContext.Provider>
  )
}
