import { store } from '@/app/store'
import i18n from '@/i18n'
import type { Progress } from '@/shared/progress'
import { setProgress } from '@/shared/progress/progressSlice'
import { updateQueueStatus } from '@/shared/queue/queueSlice'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

/**
 * React context for managing Tauri event listeners.
 *
 * This context enables automatic setup of event listeners for progress
 * events emitted from the Rust backend.
 */
const ListenerContext = createContext<boolean>(false)

/**
 * Provider component for Tauri event listeners.
 *
 * Sets up a listener for 'progress' events from the Tauri backend.
 * When progress events are received, it dispatches them to Redux state
 * and displays toast notifications for quality fallback warnings.
 * The listener is automatically cleaned up when the component unmounts.
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
    let unlisten: UnlistenFn | undefined

    const setupListener = async (): Promise<void> => {
      unlisten = await listen('progress', (event) => {
        const payload = event.payload as Progress
        store.dispatch(setProgress(payload))

        // Update queue status based on progress stage
        const stage = payload.stage
        if (stage === 'complete') {
          store.dispatch(
            updateQueueStatus({
              downloadId: payload.downloadId,
              status: 'done',
            }),
          )
        } else if (
          stage === 'audio' ||
          stage === 'video' ||
          stage === 'merge'
        ) {
          store.dispatch(
            updateQueueStatus({
              downloadId: payload.downloadId,
              status: 'running',
            }),
          )
        }

        // Show toast for quality fallback warnings
        if (stage === 'warn-video-quality-fallback' || stage === 'warn-audio-quality-fallback') {
          const key = stage === 'warn-video-quality-fallback'
            ? 'video.video_quality_fallback'
            : 'video.audio_quality_fallback'
          toast.warning(i18n.t(key, { from: 'selected', to: 'fallback' }), {
            duration: 6000,
          })
        }
      })
    }

    setupListener()

    return () => {
      unlisten?.()
    }
  }, [])
  return (
    <ListenerContext.Provider value={true}>{children}</ListenerContext.Provider>
  )
}
