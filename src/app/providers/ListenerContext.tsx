import { store } from '@/app/store'
import i18n from '@/i18n'
import type { Progress } from '@/shared/progress'
import { setProgress } from '@/shared/progress/progressSlice'
import { dequeue } from '@/shared/queue/queueSlice'
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

        if (payload.stage === 'warn-video-quality-fallback') {
          toast.warning(
            i18n.t('video.video_quality_fallback', {
              from: 'selected',
              to: 'fallback',
            }),
            { duration: 6000 },
          )
        }

        if (payload.stage === 'warn-audio-quality-fallback') {
          toast.warning(
            i18n.t('video.audio_quality_fallback', {
              from: 'selected',
              to: 'fallback',
            }),
            { duration: 6000 },
          )
        }

        store.dispatch(dequeue(payload.downloadId))
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
