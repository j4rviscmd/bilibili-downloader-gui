import { useTheme } from '@/app/contexts/ThemeContext'
import AppBar from '@/components/lib/AppBar/AppBar'
import ProgressStatusBar from '@/components/lib/Progress'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useInit } from '@/features/init/useInit'
import DownloadButton from '@/features/video/DownloadButton'
import VideoForm1 from '@/features/video/VideoForm1'
import VideoForm2 from '@/features/video/VideoForm2'
import { useUser } from '@/shared/user/useUser'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated, progress } = useInit()
  const navigate = useNavigate()
  const { user } = useUser()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <div className="n flex h-full w-full flex-col">
      <AppBar user={user} theme={theme} setTheme={setTheme} />
      <ScrollArea className="flex size-full">
        <div className="box-border flex w-full flex-col items-center justify-center px-3 py-12">
          <div className="flex h-full w-4/5 flex-col justify-center gap-12">
            <div className="block">
              <VideoForm1 />
            </div>
            <div className="block">
              <VideoForm2 />
            </div>
            <div className="box-border flex w-full justify-center p-6">
              <DownloadButton />
            </div>
          </div>
        </div>
        <ScrollBar />
      </ScrollArea>
      {progress.downloadId && (
        <div className="w-full max-w-[20rem] p-3">
          <ProgressStatusBar progress={progress} />
        </div>
      )}
    </div>
  )
}

export default HomePage
