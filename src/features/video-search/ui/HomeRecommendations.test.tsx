import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/test-utils'
import { useHomeRecommendations } from '../hooks/useHomeRecommendations'
import type { VideoSearchEntry } from '../types'
import { HomeRecommendations } from './HomeRecommendations'

vi.mock('../hooks/useHomeRecommendations', () => ({
  useHomeRecommendations: vi.fn(),
}))

const entry: VideoSearchEntry = {
  bvid: 'BV1rec0',
  title: 'Rec 0',
  cover: 'https://i0.hdslb.com/bfs/a.jpg',
  author: 'up0',
  play: 1000,
  duration: 100,
  typeid: '',
  typename: '',
}

describe('HomeRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when logged out, failed, or empty', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [],
      showSkeleton: false,
      refreshing: false,
      refresh: vi.fn(),
      visible: false,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the shelf with heading and featured grid', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [entry],
      showSkeleton: false,
      refreshing: false,
      refresh: vi.fn(),
      visible: true,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)

    // Raw key: tests run without loaded translations.
    expect(screen.getByText('popular.recommendationsTitle')).toBeVisible()
    const grid = container.querySelector('ul')
    expect(grid?.className).toContain('xl:grid-cols-2')
    // Featured variant: HORIZONTAL card — large (w-52 aspect-video) thumb
    // left, title/meta right, saving row height vs a stacked card.
    // Scoped to the grid: the heading's update button precedes it in DOM.
    const cardButton = container.querySelector('ul button')
    expect(cardButton?.className).not.toContain('flex-col')
    expect(cardButton?.querySelector('img')?.className).toContain('w-52')
    expect(grid?.className).not.toContain('md:grid-cols-2')
  })

  it('renders a featured skeleton (aria-busy) while loading', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [],
      showSkeleton: true,
      refreshing: false,
      refresh: vi.fn(),
      visible: true,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)

    expect(screen.getByText('popular.recommendationsTitle')).toBeVisible()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('ul')?.className).toContain('xl:grid-cols-2')
  })

  it('re-fetches when the update button is clicked', async () => {
    const refresh = vi.fn()
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [entry],
      showSkeleton: false,
      refreshing: false,
      refresh,
      visible: true,
    })
    const { user } = renderWithProviders(<HomeRecommendations />)

    // Raw key: tests run without loaded translations.
    await user.click(
      screen.getByRole('button', { name: 'popular.refreshRecommendations' }),
    )

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disables the update button and spins its icon while refreshing', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [entry],
      showSkeleton: false,
      refreshing: true,
      refresh: vi.fn(),
      visible: true,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)

    const button = screen.getByRole('button', {
      name: 'popular.refreshRecommendations',
    })
    expect(button).toBeDisabled()
    expect(button.querySelector('svg')?.getAttribute('class')).toContain(
      'animate-spin',
    )
    // Busy state is announced on the region (matches the skeleton branch).
    expect(container.querySelector('section')).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })
})
