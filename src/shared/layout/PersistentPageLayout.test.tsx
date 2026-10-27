/**
 * PersistentPageLayout suite.
 *
 * All page contents are stubbed with testid markers so the
 * mount-persistence strategy itself is under test: lazy mount on first
 * visit, display:none hiding, the invalid-path redirect, and the
 * page-visibility gating (settings.disabledPages).
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { act, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/pages/search', () => ({
  SearchContent: () => <div data-testid="page-search" />,
}))
vi.mock('@/pages/downloads', () => ({
  DownloadsContent: () => <div data-testid="page-downloads" />,
}))
vi.mock('@/pages/history', () => ({
  HistoryContent: () => <div data-testid="page-history" />,
}))
vi.mock('@/pages/favorite', () => ({
  FavoriteContent: () => <div data-testid="page-favorite" />,
}))
vi.mock('@/pages/watch-history', () => ({
  WatchHistoryContent: () => <div data-testid="page-watch-history" />,
}))
vi.mock('@/pages/trim', () => ({
  TrimContent: () => <div data-testid="page-trim" />,
}))
vi.mock('@/pages/concat', () => ({
  ConcatContent: () => <div data-testid="page-concat" />,
}))
vi.mock('@/pages/audio', () => ({
  AudioContent: () => <div data-testid="page-audio" />,
}))
vi.mock('@/pages/resolution', () => ({
  ResolutionContent: () => <div data-testid="page-resolution" />,
}))
vi.mock('@/pages/rotation', () => ({
  RotationContent: () => <div data-testid="page-rotation" />,
}))
vi.mock('@/pages/settings', () => ({
  SettingsContent: () => <div data-testid="page-settings" />,
}))
vi.mock('@/shared/ui/GitHubStars', () => ({
  GitHubStars: () => <div data-testid="github-stars" />,
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'

import { PersistentPageLayout } from './PersistentPageLayout'

function renderLayout(route = '/search') {
  return renderWithProviders(
    <Routes>
      <Route path="/*" element={<PersistentPageLayout />} />
    </Routes>,
    { route },
  )
}

/** The visibility wrapper the layout puts around each page. */
function wrapperOf(testid: string): HTMLElement {
  return screen.getByTestId(testid).parentElement!.parentElement!
}

describe('PersistentPageLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    // Isolate tests from each other's visibility mutations on the real
    // singleton store.
    store.dispatch(setSettings({ disabledPages: [] }))
  })

  it('renders only /search initially', () => {
    renderLayout('/search')

    expect(screen.getByTestId('page-search')).toBeInTheDocument()
    expect(screen.queryByTestId('page-history')).toBeNull()
    expect(screen.queryByTestId('page-trim')).toBeNull()
  })

  it('redirects unknown paths to /search', () => {
    renderLayout('/bogus')

    expect(screen.getByTestId('page-search')).toBeInTheDocument()
  })

  it('redirects a disabled page to /search with an explanatory toast', async () => {
    // In-app links keep pointing at hidden pages (e.g. the recent-URLs
    // list links to /history) — the redirect must not fail silently.
    store.dispatch(setSettings({ disabledPages: ['/history'] }))

    renderLayout('/history')

    expect(screen.getByTestId('page-search')).toBeInTheDocument()
    expect(screen.queryByTestId('page-history')).toBeNull()
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1))
  })

  it('treats /video-search as disabled when the popular entry is hidden', async () => {
    // Registry semantics: secondary routes share their entry's state —
    // hiding 動画検索 (/popular) must disable /video-search too.
    store.dispatch(setSettings({ disabledPages: ['/popular'] }))

    renderLayout('/video-search')

    expect(screen.getByTestId('page-search')).toBeInTheDocument()
    expect(screen.queryByTestId('page-video-search')).toBeNull()
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1))
  })

  it('unmounts a mounted page the moment it gets disabled', async () => {
    const { user } = renderLayout('/search')

    const historyNav = screen
      .getAllByText('nav.downloadHistory')
      .map((el) => el.closest('button'))
      .find((btn): btn is HTMLButtonElement => btn !== null)!
    await user.click(historyNav)
    expect(await screen.findByTestId('page-history')).toBeInTheDocument()

    // Toggling the page off in Settings must reclaim its memory, not
    // just hide the nav item — and the current view redirects.
    await act(async () => {
      store.dispatch(setSettings({ disabledPages: ['/history'] }))
    })

    expect(await screen.findByTestId('page-search')).toBeInTheDocument()
    expect(screen.queryByTestId('page-history')).toBeNull()
  })

  it('mounts a page on first visit and keeps earlier pages mounted hidden', async () => {
    const { user } = renderLayout('/search')

    // Nav item in the sidebar's Download group, located via its visible
    // span (tooltip also feeds the accessible name, so role+name is brittle)
    const historyNav = screen
      .getAllByText('nav.downloadHistory')
      .map((el) => el.closest('button'))
      .find((btn): btn is HTMLButtonElement => btn !== null)!
    await user.click(historyNav)

    expect(await screen.findByTestId('page-history')).toBeInTheDocument()
    // /search stays mounted (state preserved) but is hidden via display:none
    expect(screen.getByTestId('page-search')).toBeInTheDocument()
    expect(wrapperOf('page-search').style.display).toBe('none')
    expect(wrapperOf('page-history').style.display).toBe('')
  })
})
