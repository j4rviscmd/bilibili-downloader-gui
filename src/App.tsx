import { useSelector } from '@/app/store'
import {
  useDownloadCompletionNotifications,
  useTaskbarProgress,
} from '@/features/notifications'
import { useFontSizeShortcuts } from '@/features/settings/hooks/useFontSizeShortcuts'
import { useThemeEffect } from '@/features/settings/hooks/useThemeEffect'
import { UpdateNotification } from '@/features/updater'
import IndexPage from '@/pages'
import ErrorPage from '@/pages/error'
import InitPage from '@/pages/init'
import { PersistentPageLayout } from '@/shared/layout/PersistentPageLayout'
import { Toaster } from '@/shared/ui/sonner'
import '@/styles/global.css'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router'

function App() {
  const theme = useSelector((state) => state.settings.theme) ?? 'light'
  useThemeEffect()
  useFontSizeShortcuts()
  useTaskbarProgress()
  useDownloadCompletionNotifications()

  useEffect(() => {
    if (import.meta.env.DEV) return

    const handleContextMenu = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/init" element={<InitPage />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route path="/*" element={<PersistentPageLayout />} />
      </Routes>
      <UpdateNotification />
      <Toaster richColors theme={theme} />
    </>
  )
}

export default App
