import App from '@/App'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Routing smoke: every page is replaced by a marker so this file asserts
// ONLY the route table — which page component each path mounts. Page
// internals are covered by their own suites.
vi.mock('@/pages', () => ({
  default: () => <div>page:index</div>,
}))
vi.mock('@/pages/init', () => ({
  default: () => <div>page:init</div>,
}))
vi.mock('@/pages/error', () => ({
  default: () => <div>page:error</div>,
}))
vi.mock('@/pages/home', () => ({
  HomeContent: () => <div>page:home</div>,
}))
vi.mock('@/pages/history', () => ({
  HistoryContent: () => <div>page:history</div>,
}))
vi.mock('@/pages/favorite', () => ({
  FavoriteContent: () => <div>page:favorite</div>,
}))
vi.mock('@/pages/watch-history', () => ({
  WatchHistoryContent: () => <div>page:watch-history</div>,
}))
vi.mock('@/pages/trim', () => ({
  TrimContent: () => <div>page:trim</div>,
}))
vi.mock('@/pages/concat', () => ({
  ConcatContent: () => <div>page:concat</div>,
}))
vi.mock('@/pages/audio', () => ({
  AudioContent: () => <div>page:audio</div>,
}))
vi.mock('@/pages/resolution', () => ({
  ResolutionContent: () => <div>page:resolution</div>,
}))
vi.mock('@/pages/rotation', () => ({
  RotationContent: () => <div>page:rotation</div>,
}))

/** The persistent page mounts every visited page but hides inactive ones. */
function expectVisible(marker: string) {
  const el = screen.getByText(marker)
  // PersistentPageLayout hides inactive pages via display:none.
  expect(el.parentElement!.style.display).toBe('')
  expect(el).toBeVisible()
}

describe('App routing', () => {
  beforeEach(() => {
    // The real layout shell's GitHubStars chains .then on invoke() and
    // formats the star count; the bare vi.fn() from setup returns
    // undefined, so give the relevant commands concrete payloads.
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_repo_stars'
        ? Promise.resolve(1234)
        : Promise.resolve(undefined),
    )
  })

  it.each([
    ['/', 'page:index'],
    ['/init', 'page:init'],
    ['/error', 'page:error'],
    ['/home', 'page:home'],
    ['/history', 'page:history'],
    ['/favorite', 'page:favorite'],
    ['/watch-history', 'page:watch-history'],
    ['/trim', 'page:trim'],
    ['/concat', 'page:concat'],
    ['/audio', 'page:audio'],
    ['/resolution', 'page:resolution'],
    ['/rotation', 'page:rotation'],
  ])('mounts the right page for %s', (route, marker) => {
    renderWithProviders(<App />, { route })
    expectVisible(marker)
  })

  it('redirects unknown persistent paths to /home', () => {
    renderWithProviders(<App />, { route: '/does-not-exist' })

    expect(screen.getByText('page:home')).toBeInTheDocument()
    expect(screen.queryByText('page:index')).not.toBeInTheDocument()
  })
})
