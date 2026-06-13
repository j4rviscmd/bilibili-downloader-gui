import App from '@/App'
import { ListenerProvider } from '@/app/providers/ListenerContext'
import { UpdaterProvider } from '@/app/providers/UpdaterProvider'
import { store } from '@/app/store'
import { SplashScreen } from '@/features/splash'
import { setupI18n } from '@/i18n'
import { logger } from '@/shared/lib/logger'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'

// Initialize i18n once at startup
setupI18n()

// Setup global error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  logger.error(
    'Unhandled promise rejection',
    event.reason instanceof Error ? event.reason.message : String(event.reason),
  )
})

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Provider store={store}>
      <SplashScreen />
      <ListenerProvider>
        <UpdaterProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </UpdaterProvider>
      </ListenerProvider>
    </Provider>
  </ErrorBoundary>,
)
