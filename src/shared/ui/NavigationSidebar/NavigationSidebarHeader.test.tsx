import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NavigationSidebarHeader } from './NavigationSidebarHeader'

// The vendored sidebar shells need a SidebarProvider ancestor; passthrough
// divs keep the suite on this component's own nav logic. SidebarMenuButton
// drops its sidebar-only props (isActive/tooltip) and forwards the rest.
vi.mock('@/shared/animate-ui/radix/sidebar', () => {
  // The layout shells all collapse to the same passthrough div
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    SidebarGroup: passthrough,
    SidebarGroupContent: passthrough,
    SidebarGroupLabel: passthrough,
    SidebarMenu: passthrough,
    SidebarMenuItem: passthrough,
    SidebarMenuBadge: ({ children, ...props }: React.ComponentProps<'div'>) => (
      <div data-testid="nav-downloads-badge" {...props}>
        {children}
      </div>
    ),
    SidebarSeparator: () => <hr />,
    SidebarMenuButton: ({
      children,
      isActive,
      tooltip,
      ...props
    }: React.ComponentProps<'button'> & {
      isActive?: boolean
      tooltip?: string
    }) => {
      // Strip sidebar-only props before they hit the DOM
      void tooltip
      return (
        <button
          type="button"
          data-active={isActive ? 'true' : undefined}
          {...props}
        >
          {children}
        </button>
      )
    },
  }
})

/** Exposes the current router location for assertions. */
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  )
}

/** Pushes the bare /search entry, like the CommandBar × close does. */
function CloseSimulator() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/search')}>simulate-close</button>
}

function renderSidebar(route = '/home') {
  return renderWithProviders(
    <>
      <NavigationSidebarHeader />
      <LocationProbe />
    </>,
    { route },
  )
}

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

describe('NavigationSidebarHeader', () => {
  beforeEach(() => {
    // Reset shared singleton-store slices between tests.
    store.dispatch(setUser(loggedOutUser))
    resetQueue()
  })

  it('renders every navigation group and item with its label', () => {
    renderSidebar()

    const labels = [
      'nav.search',
      'nav.videoSearch',
      'nav.downloads',
      'nav.category.bilibili',
      'nav.favorite',
      'nav.watchHistory',
      'nav.category.tool',
      'nav.trim',
      'nav.concat',
      'nav.audio',
      'nav.resolution',
      'nav.rotation',
      'nav.gif',
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('exposes stable E2E test ids on the search and downloads items', () => {
    // data-testid is the i18n-proof selector hook for E2E specs; the
    // node carrying it must be the same menu button the aria-label
    // identifies, and items without a testId must not render one.
    renderSidebar()

    expect(screen.getByTestId('nav-search')).toBe(
      screen.getByRole('button', { name: 'nav.aria.search' }),
    )
    expect(screen.getByTestId('nav-downloads')).toBe(
      screen.getByRole('button', { name: 'nav.aria.downloads' }),
    )
    expect(
      screen.getByRole('button', { name: 'nav.aria.favorite' }),
    ).not.toHaveAttribute('data-testid')
  })

  it('marks the current route as the active page', () => {
    renderSidebar('/trim')

    const trim = screen.getByRole('button', { name: 'nav.aria.trim' })
    expect(trim).toHaveAttribute('aria-current', 'page')
    expect(trim).toHaveAttribute('data-active', 'true')

    const search = screen.getByRole('button', { name: 'nav.aria.search' })
    expect(search).not.toHaveAttribute('aria-current')
  })

  it('keeps the video-search item active on the /video-search results page', async () => {
    // The 動画検索 item targets /popular; /video-search is the same
    // feature's results page and must not deselect it.
    const { user: actor } = renderSidebar('/video-search')

    const videoSearch = screen.getByRole('button', {
      name: 'nav.aria.videoSearch',
    })
    expect(videoSearch).toHaveAttribute('aria-current', 'page')

    // Clicking the ACTIVE item is a no-op: the results view stays (it
    // must not jump to /popular) and no duplicate history entry is pushed.
    await actor.click(videoSearch)
    expect(screen.getByTestId('location')).toHaveTextContent('/video-search')
  })

  it('returns the video-search item to the last-viewed feature page', async () => {
    // Search results → another page → 動画検索: must return to the results
    // (with ?q=), not jump to /popular.
    const { user: actor } = renderSidebar('/video-search?q=kw')

    await actor.click(
      screen.getByRole('button', { name: 'nav.aria.downloads' }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/downloads')

    await actor.click(
      screen.getByRole('button', { name: 'nav.aria.videoSearch' }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/video-search')
    expect(screen.getByTestId('location')).toHaveTextContent('q=kw')
  })

  it('navigates to the clicked item path', async () => {
    const { user: actor } = renderSidebar('/search')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.concat' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/concat')
    expect(
      screen.getByRole('button', { name: 'nav.aria.concat' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('returns to the last-viewed /search entry (video query included)', async () => {
    const { user: actor } = renderSidebar(
      '/search?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1abc&page=2',
    )

    await actor.click(screen.getByRole('button', { name: 'nav.aria.trim' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/trim')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.search' }))
    // The video entry comes back instead of resetting to the empty hero.
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/search?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1abc&page=2',
    )
  })

  it('falls back to the empty /search entry before any search visit', async () => {
    const { user: actor } = renderSidebar('/trim')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.search' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/search')
  })

  it('records the bare entry after the × close, not the closed video', async () => {
    // Load a video, close it (× pushes the bare /search entry), leave,
    // return: the hero entry must come back — not the closed video's
    // ?url=…&page=… query.
    const { user: actor } = renderWithProviders(
      <>
        <NavigationSidebarHeader />
        <CloseSimulator />
        <LocationProbe />
      </>,
      {
        route:
          '/search?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1abc&page=2',
      },
    )

    await actor.click(screen.getByRole('button', { name: 'simulate-close' }))
    await actor.click(screen.getByRole('button', { name: 'nav.aria.trim' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/trim')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.search' }))
    // Exact match: the bare entry with no resurrected query string.
    expect(screen.getByTestId('location').textContent).toBe('/search')
  })

  it('falls back to the bare /search entry from a page with query params', async () => {
    // Other pages' query strings (here: the video-search results ?q=)
    // must never leak into the recorded entry or its default.
    const { user: actor } = renderSidebar('/video-search?q=kw')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.search' }))

    // Exact match: no ?q= or other foreign params ride along.
    expect(screen.getByTestId('location').textContent).toBe('/search')
  })

  it('disables auth-required items when logged out and blocks navigation', async () => {
    const { user: actor } = renderSidebar('/search')

    const favorite = screen.getByRole('button', { name: 'nav.aria.favorite' })
    expect(favorite).toHaveAttribute('aria-disabled', 'true')

    await actor.click(favorite)
    expect(screen.getByTestId('location')).toHaveTextContent('/search')
  })

  it('keeps video-search available when logged out', async () => {
    // Video search is the anonymous entry point (no SESSDATA needed), so
    // its nav item must never inherit the auth-required disabled state.
    const { user: actor } = renderSidebar('/search')

    const videoSearch = screen.getByRole('button', {
      name: 'nav.aria.videoSearch',
    })
    expect(videoSearch).not.toHaveAttribute('aria-disabled')

    await actor.click(videoSearch)
    // The 動画検索 entry point is the popular feed (/popular); keyword
    // search results live at /video-search.
    expect(screen.getByTestId('location')).toHaveTextContent('/popular')
  })

  it('enables auth-required items when logged in', async () => {
    store.dispatch(
      setUser({
        ...loggedOutUser,
        hasCookie: true,
        data: {
          uname: 'user',
          isLogin: true,
          wbiImg: { imgUrl: '', subUrl: '' },
        },
      }),
    )
    const { user: actor } = renderSidebar('/search')

    const favorite = screen.getByRole('button', { name: 'nav.aria.favorite' })
    expect(favorite).not.toHaveAttribute('aria-disabled')

    await actor.click(favorite)
    expect(screen.getByTestId('location')).toHaveTextContent('/favorite')
  })

  it('shows the active-part-count badge on the downloads item', () => {
    seedSession('BV1', [
      { partIndex: 1, cid: 11, status: 'running' },
      { partIndex: 2, cid: 12, status: 'pending' },
      { partIndex: 3, cid: 13, status: 'done' },
    ])
    renderSidebar()

    expect(screen.getByTestId('nav-downloads-badge')).toHaveTextContent('2')
  })

  it('hides the downloads badge when no part is running or pending', () => {
    seedSession('BV1', [{ partIndex: 1, cid: 11, status: 'done' }])
    renderSidebar()

    expect(screen.queryByTestId('nav-downloads-badge')).not.toBeInTheDocument()
  })

  it('stacks the downloads badge above the active-item background', () => {
    // jsdom cannot verify paint order, so the z-[2] class is the only
    // observable proxy: without it the badge hides behind the active
    // item's opaque background while /downloads is open.
    seedSession('BV1', [{ partIndex: 1, cid: 11, status: 'running' }])
    renderSidebar('/downloads')

    expect(screen.getByTestId('nav-downloads-badge')).toHaveClass('z-[2]')
  })
})
