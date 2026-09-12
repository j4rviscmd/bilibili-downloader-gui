/**
 * Settings page suite.
 *
 * Sections are stubbed; the page itself is under test: default category,
 * category switching, the became-visible settings refresh (issue #560
 * replacement for the dialog's open-refresh) and document.title.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { Link, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/ui/CategoryNav', () => ({
  CategoryNav: ({
    active,
    onSelect,
  }: {
    active: string
    onSelect: (id: never) => void
  }) => (
    <nav>
      <button type="button" onClick={() => onSelect('download' as never)}>
        nav-download
      </button>
      <span data-testid="active-category">{active}</span>
    </nav>
  ),
}))
vi.mock('@/features/settings/ui/DevOptions', () => ({
  DevOptions: () => <div data-testid="section-dev" />,
}))
vi.mock('@/features/settings/ui/sections/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="section-general" />,
}))
vi.mock('@/features/settings/ui/sections/DownloadSection', () => ({
  DownloadSection: () => <div data-testid="section-download" />,
}))
vi.mock('@/features/settings/ui/sections/StorageSection', () => ({
  StorageSection: () => <div data-testid="section-storage" />,
}))
vi.mock('@/features/settings/ui/sections/NotificationsSection', () => ({
  NotificationsSection: () => <div data-testid="section-notifications" />,
}))
vi.mock('@/features/settings/ui/sections/ToolDefaultsSection', () => ({
  ToolDefaultsSection: () => <div data-testid="section-toolDefaults" />,
}))
vi.mock('@/features/settings/ui/sections/AccountSection', () => ({
  AccountSection: () => <div data-testid="section-account" />,
}))
vi.mock('@/features/settings/ui/sections/AboutSection', () => ({
  AboutSection: () => <div data-testid="section-about" />,
}))

import { SettingsContent } from './index'

describe('SettingsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
  })

  it('renders the General section by default', () => {
    renderWithProviders(<SettingsContent />, { route: '/settings' })

    expect(screen.getByTestId('section-general')).toBeInTheDocument()
    expect(screen.queryByTestId('section-download')).toBeNull()
    // Page frame: title + auto-save note as the description
    expect(
      screen.getByRole('heading', { name: 'settings.title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('settings.auto_save_note')).toBeInTheDocument()
  })

  it('mounts the picked category when a nav item is clicked', async () => {
    const { user } = renderWithProviders(<SettingsContent />, {
      route: '/settings',
    })

    await user.click(screen.getByText('nav-download'))

    expect(screen.getByTestId('section-download')).toBeInTheDocument()
    expect(screen.queryByTestId('section-general')).toBeNull()
    expect(screen.getByTestId('active-category')).toHaveTextContent('download')
  })

  it('honors a category+anchor deep link and consumes the params (issue #421)', async () => {
    // The download status bar's limit link navigates to
    // /settings?category=download&anchor=speed-limit — the page must mount
    // that category directly and then strip the params so later manual
    // category clicks behave normally. The probe observes the in-router
    // location (MemoryRouter does not touch window.location).
    function LocationProbe() {
      const { pathname, search } = useLocation()
      return (
        <span data-testid="location-probe">
          {pathname}
          {search}
        </span>
      )
    }

    renderWithProviders(
      <>
        <SettingsContent />
        <LocationProbe />
      </>,
      { route: '/settings?category=download&anchor=speed-limit' },
    )

    expect(screen.getByTestId('section-download')).toBeInTheDocument()
    expect(screen.queryByTestId('section-general')).toBeNull()
    expect(screen.getByTestId('active-category')).toHaveTextContent('download')
    // Params consumed (replace navigation drops the query string).
    await waitFor(() =>
      expect(screen.getByTestId('location-probe')).toHaveTextContent(
        '/settings',
      ),
    )
  })

  it('re-reads settings from the backend when the page becomes visible again (issue #560)', async () => {
    // Mini-reproduction of PersistentPageLayout: the page stays mounted
    // and is merely hidden while another route is active. settings.json is
    // shared across app instances; returning to /settings must refresh the
    // in-memory snapshot.
    function Harness() {
      const { pathname } = useLocation()
      return (
        <>
          <div style={{ display: pathname === '/settings' ? 'block' : 'none' }}>
            <SettingsContent />
          </div>
          {pathname === '/home' && <Link to="/settings">back-to-settings</Link>}
          {pathname === '/settings' && <Link to="/home">go-home</Link>}
        </>
      )
    }

    const { user } = renderWithProviders(<Harness />, { route: '/home' })
    expect(mockInvoke).not.toHaveBeenCalledWith('get_settings')

    // First arrival at /settings: the page becomes visible → refresh (1).
    await user.click(screen.getByText('back-to-settings'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('get_settings'))

    // Leave and come back → refresh fires again (2), no remount involved.
    await user.click(screen.getByText('go-home'))
    await user.click(screen.getByText('back-to-settings'))
    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.filter((c) => c[0] === 'get_settings'),
      ).toHaveLength(2),
    )
  })

  it('sets document.title', () => {
    renderWithProviders(<SettingsContent />, { route: '/settings' })

    expect(document.title).toBe('settings.title - app.title')
  })
})
