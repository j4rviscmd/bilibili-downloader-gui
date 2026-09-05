/**
 * PageLayoutShell suite.
 *
 * Heavy siblings are stubbed (SettingsDialog has its own suite); the
 * sidebar/app-bar chrome, route-aware nav button and children slot are
 * asserted against the real store.
 */

import { store } from '@/app/store'
import { setOpenDialog } from '@/features/settings/settingsSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/dialog/SettingsDialog', () => ({
  default: () => <div data-testid="settings-dialog" />,
}))
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
function historyNavButton(): HTMLElement {
  return screen
    .getAllByText('nav.downloadHistory')
    .map((el) => el.closest('button'))
    .find((btn): btn is HTMLButtonElement => btn !== null)!
}

describe('PageLayoutShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setOpenDialog(false))
  })

  it('renders the chrome and children', () => {
    renderShell()

    expect(screen.getByText('page-body')).toBeInTheDocument()
    // Chrome pieces: sidebar trigger, settings dialog slot, app bar
    // (label depends on the sidebar's collapsed state)
    expect(
      screen.getByRole('button', { name: /nav\.aria\.(open|close)Sidebar/ }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'settings.title' }),
    ).toBeInTheDocument()
  })

  it('marks the history nav active only on /history', () => {
    renderShell('/history')

    expect(historyNavButton().getAttribute('data-active')).toBe('true')
  })

  it('leaves the history nav inactive on other routes', () => {
    renderShell('/home')

    expect(historyNavButton().getAttribute('data-active')).toBe('false')
  })

  it('clicking the history nav navigates to /history', async () => {
    const { user } = renderShell('/home')

    await user.click(historyNavButton())

    // Route changed: the shell re-rendered with /history active
    await vi.waitFor(() =>
      expect(historyNavButton().getAttribute('data-active')).toBe('true'),
    )
  })

  it('the footer settings button opens the settings dialog state', async () => {
    const { user } = renderShell('/home')

    await user.click(screen.getByRole('button', { name: 'settings.title' }))

    expect(store.getState().settings.dialogOpen).toBe(true)
  })
})
