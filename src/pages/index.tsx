import { useInit } from '@/features/init'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * Index page component (root route).
 *
 * Redirects to /search if initialized, otherwise to /init.
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
    // Why: replace instead of push so the transient `/` entry does not
    // stay in the history stack — otherwise the app bar back button
    // (issue #692) returns here and this redirect bounces forward again.
    if (initiated) {
      navigate('/search', { replace: true })
    } else {
      navigate('/init', { replace: true })
    }
  }, [initiated, navigate])

  return null
}

export default IndexPage
