/**
 * PersistentPageLayout suite.
 *
 * All nine page contents are stubbed with testid markers so the
 * mount-persistence strategy itself is under test: lazy mount on first
 * visit, display:none hiding, and the invalid-path redirect.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/pages/home', () => ({
  HomeContent: () => <div data-testid="page-home" />,
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
vi.mock('@/shared/ui/GitHubStars', () => ({
  GitHubStars: () => <div data-testid="github-stars" />,
}))

import { PersistentPageLayout } from './PersistentPageLayout'

function renderLayout(route = '/home') {
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
  })

  it('renders only /home initially', () => {
    renderLayout('/home')

    expect(screen.getByTestId('page-home')).toBeInTheDocument()
    expect(screen.queryByTestId('page-history')).toBeNull()
    expect(screen.queryByTestId('page-trim')).toBeNull()
  })

  it('redirects unknown paths to /home', () => {
    renderLayout('/bogus')

    expect(screen.getByTestId('page-home')).toBeInTheDocument()
  })

  it('mounts a page on first visit and keeps earlier pages mounted hidden', async () => {
    const { user } = renderLayout('/home')

    // Footer nav button, located via its visible span (tooltip also feeds
    // the accessible name, so role+name is brittle)
    const historyNav = screen
      .getAllByText('nav.downloadHistory')
      .map((el) => el.closest('button'))
      .find((btn): btn is HTMLButtonElement => btn !== null)!
    await user.click(historyNav)

    expect(await screen.findByTestId('page-history')).toBeInTheDocument()
    // /home stays mounted (state preserved) but is hidden via display:none
    expect(screen.getByTestId('page-home')).toBeInTheDocument()
    expect(wrapperOf('page-home').style.display).toBe('none')
    expect(wrapperOf('page-history').style.display).toBe('')
  })
})
