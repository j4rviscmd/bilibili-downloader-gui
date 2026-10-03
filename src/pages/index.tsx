import type { RootState } from '@/app/store'
import { useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import { PAGE_PATHS } from '@/shared/layout/pages'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * Index page component (root route).
 *
 * Redirects to the configured startup page (settings.startupPage, default
 * /search) if initialized, otherwise to /init. Unknown stored paths fall
 * back to /search. Does not render any UI.
 *
 * @example
 * ```tsx
 * <Route path="/" element={<IndexPage />} />
 * ```
 */
function IndexPage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const startupPage = useSelector(
    (state: RootState) => state.settings.startupPage,
  )

  useEffect(() => {
    if (!initiated) {
      navigate('/init', { replace: true })
      return
    }
    // Why: a stale settings.json can name a removed/renamed route; an
    // unknown path would land on the invalid-route screen, so fall back.
    const known =
      startupPage !== undefined &&
      (PAGE_PATHS as readonly string[]).includes(startupPage)
    const target = known ? startupPage : '/search'
    // Why: replace instead of push so the transient `/` entry does not
    // stay in the history stack — otherwise the app bar back button
    // (issue #692) returns here and this redirect bounces forward again.
    navigate(target, { replace: true })
  }, [initiated, startupPage, navigate])

  return null
}

export default IndexPage
