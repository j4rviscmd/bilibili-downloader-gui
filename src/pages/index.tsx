import { useInit } from '@/features/init'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * Index page component (root route).
 *
 * Redirects to /home if initialized, otherwise to /init.
 * Does not render any UI.
 *
 * @example
 * ```tsx
 * <Route path="/" element={<IndexPage />} />
 * ```
 */
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
