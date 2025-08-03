import IndexPage from '@/pages'
import { Route, Routes } from 'react-router'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
    </Routes>
  )
}

export default App
