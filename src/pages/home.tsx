import { useInit } from '@/features/init/useInit'
import InputFields from '@/features/video'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <div className="bg-background flex h-full w-full items-center justify-center">
      <div className="w-4/5">
        <InputFields />
      </div>
    </div>
  )
}

export default HomePage
