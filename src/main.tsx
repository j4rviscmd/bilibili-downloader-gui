import App from '@/App'
import { ListenerProvider } from '@/app/providers/ListenerContext'
import { UpdaterProvider } from '@/app/providers/UpdaterProvider'
import { store } from '@/app/store'
import { SplashScreen } from '@/features/splash'
import { setupI18n } from '@/i18n'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { logger } from '@/shared/lib/logger'
import { executeDownloadPart } from '@/shared/queue/api/executeDownloadPart'
import { createQueueRunner } from '@/shared/queue/runner'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'

// Initialize i18n once at startup
setupI18n()

// If this is the splash window, apply the user's language and theme from the
// query params (passed by create_splash_window) so splash labels render in
// the correct language and `dark:` variants resolve, from the first frame.
if (window.location.pathname.startsWith('/splashscreen')) {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  if (lang) {
    changeLanguage(lang as SupportedLang).catch(() => {})
  }
  // The theme param is authoritative (settings.json read by the Rust side).
  // index.html's inline script already guessed a class from localStorage,
  // which can drift from settings.json — re-sync it here.
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  // Note: Tailwind `dark:` classes do not reach native controls — the setup
  // screen's <select> popup is drawn by the OS, which only follows
  // `color-scheme`. Keeping it in sync with the class avoids a light popup
  // on the dark splash.
  document.documentElement.style.colorScheme = theme
  // Why clear html/body background: the splash window is transparent (rounded
  // corners rendered via CSS). index.html's inline theme script and index.css
  // set an opaque html/body background, which would fill the area outside the
  // rounded corners with a solid color (near-black in dark mode). Clearing it
  // here lets the desktop show through the corner regions.
  document.documentElement.style.backgroundColor = 'transparent'
  document.body.style.backgroundColor = 'transparent'
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

// Serial download-queue runner (issue #691): React-external, started exactly
// once in the main window. The splash window must NOT start one — it never
// enqueues and its store dies when the splash closes, which would strand a
// drain loop mid-session.
if (!isSplashWindow) {
  createQueueRunner(executeDownloadPart, () => store).start()
}

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
