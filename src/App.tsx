import IndexPage from '@/pages'
import HomePage from '@/pages/home'
import InitPage from '@/pages/init'
import '@/styles/global.css'
import { Route, Routes } from 'react-router'

function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/init" element={<InitPage />} />
      <Route path="/home" element={<HomePage />} />
    </Routes>
  )
}

export default App
