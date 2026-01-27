import { store } from '@/app/store'
import i18n from '@/i18n'
import type { Progress } from '@/shared/progress'
import { setProgress } from '@/shared/progress/progressSlice'
import { dequeue } from '@/shared/queue/queueSlice'
import { listen } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'
import { toast } from 'sonner'

const ListenerContext = createContext<boolean>(false)
// export const useListener = () => useContext(ListenerContext)
export const ListenerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Placeholder for any side effects or listeners that need to be set up
    console.log('ListenerProvider mounted')
    listen('progress', (event) => {
      // console.log('Progress event received:', event.payload)
      const payload: Progress = event.payload as Progress
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
      // On first progress event for a downloadId we assume it moved from queued -> in-progress
      store.dispatch(dequeue(payload.downloadId))
      // If complete, ensure it's removed from progress later (UI may clear)
      if (payload.isComplete) {
        // ensure queue is clean
        store.dispatch(dequeue(payload.downloadId))
      }
    })

    return () => {
      // Cleanup if necessary
      console.log('ListenerProvider unmounted')
    }
  }, [])
  return (
    <ListenerContext.Provider value={true}>{children}</ListenerContext.Provider>
  )
}
