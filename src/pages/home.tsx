import { useInit } from '@/features/init/useInit'
import VideoForm from '@/features/video'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { input, onChange } = useVideoInfo()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <div className="bg-background flex h-full w-full items-center justify-center">
      <div className="w-4/5">
        <VideoForm input={input} onChange={onChange} />
      </div>
    </div>
  )
}

export default HomePage
