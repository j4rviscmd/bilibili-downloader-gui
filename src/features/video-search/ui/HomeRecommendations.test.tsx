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
      visible: false,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the shelf with heading and featured grid', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [entry],
      showSkeleton: false,
      visible: true,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)

    // Raw key: tests run without loaded translations.
    expect(screen.getByText('popular.recommendationsTitle')).toBeVisible()
    const grid = container.querySelector('ul')
    expect(grid?.className).toContain('xl:grid-cols-2')
    // Featured variant: HORIZONTAL card — large (w-52 aspect-video) thumb
    // left, title/meta right, saving row height vs a stacked card.
    const cardButton = container.querySelector('button')
    expect(cardButton?.className).not.toContain('flex-col')
    expect(cardButton?.querySelector('img')?.className).toContain('w-52')
    expect(grid?.className).not.toContain('md:grid-cols-2')
  })

  it('renders a featured skeleton (aria-busy) while loading', () => {
    vi.mocked(useHomeRecommendations).mockReturnValue({
      entries: [],
      showSkeleton: true,
      visible: true,
    })
    const { container } = renderWithProviders(<HomeRecommendations />)

    expect(screen.getByText('popular.recommendationsTitle')).toBeVisible()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('ul')?.className).toContain('xl:grid-cols-2')
  })
})
