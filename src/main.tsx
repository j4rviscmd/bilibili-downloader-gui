import App from '@/App'
import { ListenerProvider } from '@/app/providers/ListenerContext'
import { UpdaterProvider } from '@/app/providers/UpdaterProvider'
import { store } from '@/app/store'
import { SplashScreen } from '@/features/splash'
import { setupI18n } from '@/i18n'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { logger } from '@/shared/lib/logger'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'

// Initialize i18n once at startup
setupI18n()

// If this is the splash window, apply the user's language from the query param
// (passed by create_splash_window) so splash labels render in the correct
// language from the first frame.
if (window.location.pathname.startsWith('/splashscreen')) {
  const lang = new URLSearchParams(window.location.search).get('lang')
  if (lang) {
    changeLanguage(lang as SupportedLang).catch(() => {})
  }
}

// Setup global error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  logger.error(
    'Unhandled promise rejection',
    event.reason instanceof Error ? event.reason.message : String(event.reason),
  )
})

// Two-window model: the splash window is served at "/splashscreen" and the
// main window at "/". Each is its own webview with its own Redux store; the
// splash runs backend init then invokes finish_splash to create the main window.
const isSplashWindow = window.location.pathname.startsWith('/splashscreen')

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Provider store={store}>
      {isSplashWindow ? (
        <SplashScreen />
      ) : (
        <ListenerProvider>
          <UpdaterProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </UpdaterProvider>
        </ListenerProvider>
      )}
    </Provider>
  </ErrorBoundary>,
)
