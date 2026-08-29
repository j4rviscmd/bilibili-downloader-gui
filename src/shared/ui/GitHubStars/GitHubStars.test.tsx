import {
  getCachedStars,
  isCacheValid,
  setCachedStars,
} from '@/shared/lib/githubStarsCache'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubStars } from './GitHubStars'

// The cache is a pure localStorage wrapper; mock it so tests control
// cache hits without touching storage state.
vi.mock('@/shared/lib/githubStarsCache', () => ({
  getCachedStars: vi.fn(),
  isCacheValid: vi.fn(),
  setCachedStars: vi.fn(),
}))

describe('GitHubStars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cache miss
    vi.mocked(getCachedStars).mockReturnValue(null)
    vi.mocked(isCacheValid).mockReturnValue(false)
  })

  it('fetches and renders the formatted star count', async () => {
    mockInvoke.mockResolvedValue(1234)

    renderWithProviders(
      <GitHubStars owner="j4rviscmd" repo="bilibili-downloader-gui" />,
    )

    // Loading placeholder until the invoke resolves
    expect(screen.getByText('---')).toBeInTheDocument()
    expect(await screen.findByText('1.2k')).toBeInTheDocument()

    expect(mockInvoke).toHaveBeenCalledWith('get_repo_stars', {
      owner: 'j4rviscmd',
      repo: 'bilibili-downloader-gui',
    })
    expect(setCachedStars).toHaveBeenCalledWith(
      'j4rviscmd',
      'bilibili-downloader-gui',
      1234,
    )
  })

  it('renders counts under 1000 without the k suffix', async () => {
    mockInvoke.mockResolvedValue(999)

    renderWithProviders(<GitHubStars owner="o" repo="r" />)

    expect(await screen.findByText('999')).toBeInTheDocument()
  })

  it('links to the stargazers page with a count tooltip label', () => {
    vi.mocked(getCachedStars).mockReturnValue(42)
    vi.mocked(isCacheValid).mockReturnValue(true)

    renderWithProviders(<GitHubStars owner="j4rviscmd" repo="app" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/j4rviscmd/app/stargazers',
    )
    // Identity t: 'github.stars' with count interpolation leaves the key as-is
    expect(link).toHaveAttribute('aria-label', 'github.stars')
  })

  it('skips the fetch entirely on a valid cache hit', () => {
    vi.mocked(getCachedStars).mockReturnValue(42)
    vi.mocked(isCacheValid).mockReturnValue(true)

    renderWithProviders(<GitHubStars owner="o" repo="r" />)

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('falls back to the repo label silently when the fetch fails', async () => {
    mockInvoke.mockRejectedValue(new Error('rate limited'))

    renderWithProviders(<GitHubStars owner="o" repo="r" />)

    // Keeps the placeholder; no cached value exists to fall back to
    await screen.findByText('---')
    expect(screen.getByRole('link')).toHaveAttribute(
      'aria-label',
      'github.repo',
    )
    expect(screen.queryByText('1.2k')).not.toBeInTheDocument()
  })
})
