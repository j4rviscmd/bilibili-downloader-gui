import App from '@/App'
import { ListenerProvider } from '@/app/providers/ListenerContext'
import { ThemeProvider } from '@/app/providers/ThemeContext'
import { store } from '@/app/store'
import { setupI18n } from '@/i18n'
import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'

// initialize i18n once at startup
setupI18n()

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ThemeProvider storageKey="ui-theme">
      <ListenerProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ListenerProvider>
    </ThemeProvider>
  </Provider>,
)
