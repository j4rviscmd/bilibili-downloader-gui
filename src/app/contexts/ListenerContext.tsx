import { store } from '@/app/store'
import { sleep } from '@/lib/utils'
import type { Progress } from '@/shared/progress'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
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
      if (payload.isComplete) {
        sleep(500).then(() => {
          store.dispatch(clearProgress())
        })
      } else {
        let progress = event.payload as Progress
        progress = {
          ...progress,
          // 経過時間(s)を四捨五入して整数にする
          elapsedTime: Math.round(progress.elapsedTime),
        }
        store.dispatch(setProgress(progress))
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
