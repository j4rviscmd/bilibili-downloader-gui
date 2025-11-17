import { store } from '@/app/store'
import type { Progress } from '@/shared/progress'
import { setProgress } from '@/shared/progress/progressSlice'
import { listen } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'

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
