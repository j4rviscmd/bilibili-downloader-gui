import { store } from '@/app/store'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { addEntry } from '@/features/history/model/historySlice'
import i18n from '@/i18n'
import type { Progress } from '@/shared/progress'
import {
  clearProgressByDownloadId,
  setProgress,
} from '@/shared/progress/progressSlice'
import { clearQueueItem, updateQueueStatus } from '@/shared/queue/queueSlice'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

interface DownloadCancelledPayload {
  downloadId: string
}

/**
 * Tauri イベントリスナー管理用の React Context。
 *
 * Rust バックエンドから発行されるプログレスイベントのリスナーを
 * 自動的にセットアップするためのコンテキスト。
 */
const ListenerContext = createContext<boolean>(false)

/**
 * Tauri イベントリスナー用の Provider コンポーネント。
 *
 * Tauri バックエンドからの 'progress' イベントのリスナーをセットアップします。
 * プログレスイベントを受信すると、Redux ステートにディスパッチし、
 * 画質フォールバック警告に対してトースト通知を表示します。
 * コンポーネントのアンマウント時にリスナーは自動的にクリーンアップされます。
 *
 * @param props - コンポーネント props
 * @param props.children - このプロバイダーでラップする子コンポーネント
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
          // Remove queue item to restore pre-download state
          store.dispatch(clearQueueItem(downloadId))
          // Clear progress entries for this download
          store.dispatch(clearProgressByDownloadId(downloadId))
          // Show toast notification
          toast.info(i18n.t('video.download_cancelled'))
        },
      )
    }

    setupListeners()

    return () => {
      unlistenProgress?.()
      unlistenHistory?.()
      unlistenCancelled?.()
    }
  }, [])
  return (
    <ListenerContext.Provider value={true}>{children}</ListenerContext.Provider>
  )
}
