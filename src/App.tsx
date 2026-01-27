import { useTheme } from '@/app/providers/ThemeContext'
import { Toaster } from '@/shared/ui/sonner'
import IndexPage from '@/pages'
import ErrorPage from '@/pages/error'
import HomePage from '@/pages/home'
import InitPage from '@/pages/init'
import '@/styles/global.css'
import { Route, Routes } from 'react-router'

function App() {
  const { theme } = useTheme()

  return (
    <>
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/init" element={<InitPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/error" element={<ErrorPage />} />
      </Routes>
      <Toaster richColors theme={theme} />
    </>
  )
}

export default App
