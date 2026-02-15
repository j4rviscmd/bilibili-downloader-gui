import { useTheme } from '@/app/providers/ThemeContext'
import { UpdateNotification } from '@/features/updater'
import IndexPage from '@/pages'
import ErrorPage from '@/pages/error'
import InitPage from '@/pages/init'
import { PersistentPageLayout } from '@/shared/layout/PersistentPageLayout'
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
 * - `/home` - Main application page (persistent)
 * - `/history` - Download history page (persistent)
 * - `/favorite` - Favorite videos page (persistent)
 * - `/watch-history` - Watch history page (persistent)
 * - `/error` - Error page
 *
 * The persistent pages (/home, /history, /favorite, /watch-history) are managed
 * by PersistentPageLayout which keeps them mounted to preserve state across
 * navigation. Inactive pages are hidden with display:none.
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
        <Route path="/error" element={<ErrorPage />} />
        <Route path="/*" element={<PersistentPageLayout />} />
      </Routes>
      <UpdateNotification />
      <Toaster richColors theme={theme} />
    </>
  )
}

export default App
