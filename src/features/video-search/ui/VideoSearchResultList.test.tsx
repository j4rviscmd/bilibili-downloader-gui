import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { VideoSearchResultList } from './VideoSearchResultList'

vi.mock('../hooks/useVideoSearch', () => ({
  useVideoSearch: vi.fn(),
}))
vi.mock('@/shared/hooks/usePendingDownload', () => ({
  usePendingDownload: vi.fn(),
}))

const baseState: VideoSearchView = {
  keyword: 'kw',
  page: 1,
  numPages: 2,
  numResults: 40,
  loading: false,
  error: null,
  entries: [
    {
      bvid: 'BV1De411p77r',
      title: '少年 官方版',
      cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
      author: 'up主',
      play: 1037655,
      duration: 287,
    },
  ],
  search: vi.fn(),
  goToPage: vi.fn(),
}

describe('VideoSearchResultList', () => {
  it('renders entry fields and click hands off to the download flow', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)

    const { user } = renderWithProviders(<VideoSearchResultList />)

    expect(screen.getByText('少年 官方版')).toBeInTheDocument()
    expect(screen.getByText('up主')).toBeInTheDocument()
    expect(screen.getByText(/4:47/)).toBeInTheDocument()
    // Total count summary line (raw key — {{count}} never lands in the key).
    expect(screen.getByText('videoSearch.resultsCount')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /少年 官方版/ }))
    // Favorites pattern: no cid — resolved later by the URL search page.
    expect(handleDownload).toHaveBeenCalledWith('BV1De411p77r', null, 1)
  })

  it('renders the localized no-results message', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      entries: [],
      numResults: 0,
    })
    renderWithProviders(<VideoSearchResultList />)
    // i18n test setup returns raw keys.
    expect(screen.getByText('videoSearch.noResults')).toBeInTheDocument()
  })
})
