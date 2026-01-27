import { useInit } from '@/features/init'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function IndexPage() {
  const { initiated } = useInit()
  const navigate = useNavigate()

  useEffect(() => {
    if (initiated) {
      navigate('/home')
    } else {
      navigate('/init')
    }
  }, [initiated, navigate])

  return null
}

export default IndexPage
