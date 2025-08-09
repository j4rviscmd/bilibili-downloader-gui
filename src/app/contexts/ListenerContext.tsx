import { listen } from '@tauri-apps/api/event'
import { createContext, useEffect, type FC, type ReactNode } from 'react'

const ListenerContext = createContext<boolean>(false)
// export const useListener = () => useContext(ListenerContext)
export const ListenerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Placeholder for any side effects or listeners that need to be set up
    console.log('ListenerProvider mounted')
    listen('progress', (event) => {
      console.log('Progress event received:', event.payload)

      // Handle the progress event here
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
