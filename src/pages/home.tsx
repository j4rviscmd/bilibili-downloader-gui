import { useTheme } from '@/app/contexts/ThemeContext'
import AppBar from '@/components/lib/AppBar/AppBar'
import { useInit } from '@/features/init/useInit'
import VideoForm1 from '@/features/video/VideoForm1'
import VideoForm2 from '@/features/video/VideoForm2'
import { useUser } from '@/shared/user/useUser'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { user } = useUser()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <div className="flex h-full w-full flex-col">
      <AppBar user={user} theme={theme} setTheme={setTheme} />
      <div className="flex w-full flex-1 items-center justify-center">
        <div className="flex w-4/5 flex-col gap-12">
          <div className="block">
            <VideoForm1 />
          </div>
          <div className="block">
            <VideoForm2 />
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomePage
