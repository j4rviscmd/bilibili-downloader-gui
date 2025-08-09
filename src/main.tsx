import '@/styles/index.css'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'
import App from './App'
import { ListenerProvider } from './app/contexts/ListenerContext'
import { store } from './app/store'

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ListenerProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ListenerProvider>
  </Provider>,
)
