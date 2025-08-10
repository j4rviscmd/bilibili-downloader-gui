import { useInit } from '@/features/init/useInit'
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
      <div className="text-primary">home</div>
    </div>
  )
}

export default HomePage
