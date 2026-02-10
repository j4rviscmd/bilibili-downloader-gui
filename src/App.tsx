import { useTheme } from '@/app/providers/ThemeContext'
import { UpdateNotification } from '@/features/updater'
import IndexPage from '@/pages'
import ErrorPage from '@/pages/error'
import HistoryPage from '@/pages/history'
import HomePage from '@/pages/home'
import InitPage from '@/pages/init'
import { Toaster } from '@/shared/ui/sonner'
import '@/styles/global.css'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router'

/**
 * Root application component.
 *
 * Sets up routing for the application with the following pages:
 * - `/` - Index page (redirects to /init or /home)
 * - `/init` - Initialization page
 * - `/home` - Main application page
 * - `/error` - Error page
 *
 * Also configures the toast notification system with theme support.
 * In production mode, disables the right-click context menu to prevent
 * access to browser developer tools and inspect element functionality.
 *
 * @example
 * ```tsx
 * <App />
 * ```
 */
function App() {
  const { theme } = useTheme()

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
        <Route path="/home" element={<HomePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/error" element={<ErrorPage />} />
      </Routes>
      <UpdateNotification />
      <Toaster richColors theme={theme} />
    </>
  )
}

export default App
