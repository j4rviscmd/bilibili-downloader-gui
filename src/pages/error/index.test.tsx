import ErrorPage from '@/pages/error'
import { renderWithProviders } from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { screen } from '@testing-library/react'
import { useEffect } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Navigates to /error with the given router state on mount, so the page's
 * useLocation().state can be exercised (MemoryRouter initialEntries accept
 * state objects, but the shared render helper only takes a path string).
 */
function StatefulHarness({ state }: { state: Record<string, unknown> }) {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/error', { state })
  }, [navigate])

  return (
    <Routes>
      <Route path="/error" element={<ErrorPage />} />
    </Routes>
  )
}

function renderErrorPage(state: Record<string, unknown> = {}) {
  return renderWithProviders(<StatefulHarness state={state} />, {
    route: '/',
  })
}

describe('ErrorPage', () => {
  beforeEach(() => {
    // The plugin mocks are module-global; earlier tests' clicks would
    // otherwise accumulate call counts across tests in this file.
    vi.clearAllMocks()
  })

  it('renders the frame with the error code and unexpected fallback', async () => {
    const { user } = renderErrorPage({ errorCode: 0 })

    expect(await screen.findByText('errorPage.title')).toBeInTheDocument()
    expect(screen.getByText('errorPage.cannot_continue')).toBeInTheDocument()
    expect(screen.getByText('errorPage.unexpected')).toBeInTheDocument()
    // Code label renders the raw numeric code next to the label key.
    expect(screen.getByText(/errorPage\.code_label/)).toHaveTextContent('0')
    // No restart affordances for unknown codes; quit is always available.
    expect(screen.queryByText('errorPage.restart_app')).not.toBeInTheDocument()
    expect(screen.queryByText('errorPage.try_restart')).not.toBeInTheDocument()
    expect(screen.getByText('errorPage.quit_app')).toBeInTheDocument()
    await user.click(screen.getByText('errorPage.quit_app'))
  })

  it('shows the per-code message for each mapped error code', async () => {
    const cases: [number, string][] = [
      [1, 'errorPage.ffmpeg_not_found'],
      [2, 'errorPage.cookie_invalid'],
      [4, 'errorPage.user_info_failed_other'],
      [5, 'errorPage.version_check_failed'],
    ]
    for (const [code, key] of cases) {
      const { unmount } = renderErrorPage({ errorCode: code })
      expect(await screen.findByText(key)).toBeInTheDocument()
      unmount()
    }
  })

  it('offers a bilibili.com link for the not-logged-in error (code 3)', async () => {
    const { user } = renderErrorPage({ errorCode: 3 })

    const link = await screen.findByText('bilibili.com')
    await user.click(link)
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith('https://www.bilibili.com')
    expect(screen.getByText('errorPage.visit_and_login')).toBeInTheDocument()
  })

  it('renders the backend error detail for settings init failure (code 6)', async () => {
    renderErrorPage({ errorCode: 6, errorDetail: 'settings.json corrupt' })

    expect(
      await screen.findByText('errorPage.settings_init_failed'),
    ).toBeInTheDocument()
    expect(screen.getByText('settings.json corrupt')).toBeInTheDocument()
  })

  it('shows restart (not just quit) for codes 1 and 6 and relaunches on click', async () => {
    for (const code of [1, 6]) {
      const { user, unmount } = renderErrorPage({ errorCode: code })
      expect(
        await screen.findByText('errorPage.restart_app'),
      ).toBeInTheDocument()
      expect(screen.getByText('errorPage.try_restart')).toBeInTheDocument()
      await user.click(screen.getByText('errorPage.restart_app'))
      expect(vi.mocked(relaunch)).toHaveBeenCalled()
      unmount()
      vi.mocked(relaunch).mockClear()
    }
  })

  it('quits the app via useInit.quitApp on the destructive button', async () => {
    const { user } = renderErrorPage({ errorCode: 2 })

    await user.click(await screen.findByText('errorPage.quit_app'))
    expect(vi.mocked(exit)).toHaveBeenCalledTimes(1)
  })
})
