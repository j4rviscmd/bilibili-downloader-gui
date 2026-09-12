/**
 * PageLayoutShell suite.
 *
 * Heavy siblings are stubbed; the sidebar/app-bar chrome, the route-aware
 * nav buttons (download history + settings page) and the children slot
 * are asserted against the real store.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// AppBar chrome: GitHubStars fetches star counts (own suite in shared/ui)
vi.mock('@/shared/ui/GitHubStars', () => ({
  GitHubStars: () => <div data-testid="github-stars" />,
}))

import { PageLayoutShell } from './PageLayout'

function renderShell(route = '/home') {
  return renderWithProviders(
    <Routes>
      <Route path="/*" element={<PageLayoutShell>page-body</PageLayoutShell>} />
    </Routes>,
    { route },
  )
}

/**
 * The footer nav button, located via its visible span (tooltip also
 * contributes to the accessible name, so role+name is brittle).
 */
function navButton(labelKey: string): HTMLElement {
  return screen
    .getAllByText(labelKey)
    .map((el) => el.closest('button'))
    .find((btn): btn is HTMLButtonElement => btn !== null)!
}

describe('PageLayoutShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the chrome and children', () => {
    renderShell()

    expect(screen.getByText('page-body')).toBeInTheDocument()
    // Chrome pieces: sidebar trigger, settings nav, app bar
    // (label depends on the sidebar's collapsed state)
    expect(
      screen.getByRole('button', { name: /nav\.aria\.(open|close)Sidebar/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'settings.title' }),
    ).toBeInTheDocument()
  })

  it('marks the history nav active only on /history', () => {
    renderShell('/history')

    expect(navButton('nav.downloadHistory').getAttribute('data-active')).toBe(
      'true',
    )
  })

  it('leaves the history nav inactive on other routes', () => {
    renderShell('/home')

    expect(navButton('nav.downloadHistory').getAttribute('data-active')).toBe(
      'false',
    )
  })

  it('clicking the history nav navigates to /history', async () => {
    const { user } = renderShell('/home')

    await user.click(navButton('nav.downloadHistory'))

    // Route changed: the shell re-rendered with /history active
    await vi.waitFor(() =>
      expect(navButton('nav.downloadHistory').getAttribute('data-active')).toBe(
        'true',
      ),
    )
  })

  it('marks the settings nav active only on /settings', () => {
    renderShell('/settings')

    expect(navButton('settings.title').getAttribute('data-active')).toBe('true')
  })

  it('clicking the settings footer button navigates to /settings', async () => {
    const { user } = renderShell('/home')

    await user.click(navButton('settings.title'))

    await vi.waitFor(() =>
      expect(navButton('settings.title').getAttribute('data-active')).toBe(
        'true',
      ),
    )
  })
})
