import App from '@/App'
import { ListenerProvider } from '@/app/contexts/ListenerContext'
import { ThemeProvider } from '@/app/contexts/ThemeContext'
import { store } from '@/app/store'
import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'

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
