import { useTheme } from '@/app/contexts/ThemeContext'
import AppBar from '@/components/lib/AppBar/AppBar'
import { useInit } from '@/features/init/useInit'
import VideoForm from '@/features/video'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { input, onChange } = useVideoInfo()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <div className="flex h-full w-full flex-col">
      <AppBar theme={theme} setTheme={setTheme} />
      <div className="flex w-full flex-1 items-center justify-center">
        <div className="w-4/5">
          <VideoForm input={input} onChange={onChange} />
        </div>
      </div>
    </div>
  )
}

export default HomePage
