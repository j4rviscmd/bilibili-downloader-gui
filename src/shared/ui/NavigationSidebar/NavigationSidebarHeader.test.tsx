import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { setHomePage } from '@/features/video/model/inputSlice'
import { clearQueue } from '@/shared/queue'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
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
    store.dispatch(clearQueue())
    store.dispatch(setHomePage(1))
  })

  it('renders every navigation group and item with its label', () => {
    renderSidebar()

    const labels = [
      'nav.home',
      'nav.category.bilibili',
      'nav.favorite',
      'nav.watchHistory',
      'nav.category.tool',
      'nav.trim',
      'nav.concat',
      'nav.audio',
      'nav.resolution',
      'nav.rotation',
    ]
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks the current route as the active page', () => {
    renderSidebar('/trim')

    const trim = screen.getByRole('button', { name: 'nav.aria.trim' })
    expect(trim).toHaveAttribute('aria-current', 'page')
    expect(trim).toHaveAttribute('data-active', 'true')

    const home = screen.getByRole('button', { name: 'nav.aria.home' })
    expect(home).not.toHaveAttribute('aria-current')
  })

  it('navigates to the clicked item path', async () => {
    const { user: actor } = renderSidebar('/home')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.concat' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/concat')
    expect(
      screen.getByRole('button', { name: 'nav.aria.concat' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('restores the last-viewed ?page= param on Home navigation', async () => {
    store.dispatch(setHomePage(3))
    const { user: actor } = renderSidebar('/trim')

    await actor.click(screen.getByRole('button', { name: 'nav.aria.home' }))

    // The Home button returns to the paginated page the user was on,
    // taking URL priority over any stale ?p embedded in input.url.
    expect(screen.getByTestId('location')).toHaveTextContent('/home?page=3')
  })

  it('disables auth-required items when logged out and blocks navigation', async () => {
    const { user: actor } = renderSidebar('/home')

    const favorite = screen.getByRole('button', { name: 'nav.aria.favorite' })
    expect(favorite).toHaveAttribute('aria-disabled', 'true')

    await actor.click(favorite)
    expect(screen.getByTestId('location')).toHaveTextContent('/home')
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
    const { user: actor } = renderSidebar('/home')

    const favorite = screen.getByRole('button', { name: 'nav.aria.favorite' })
    expect(favorite).not.toHaveAttribute('aria-disabled')

    await actor.click(favorite)
    expect(screen.getByTestId('location')).toHaveTextContent('/favorite')
  })
})
