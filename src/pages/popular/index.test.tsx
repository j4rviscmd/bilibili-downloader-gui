import { fetchPopularVideosApi } from '@/features/video-search'
import { searchVideosApi } from '@/features/video-search/api/searchVideos'
import { VideoSearchContent } from '@/pages/video-search'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopularContent } from './index'

vi.mock('@/features/video-search/api/searchVideos', () => ({
  searchVideosApi: vi.fn(),
}))
vi.mock('@/features/video-search/api/fetchPopularVideos', () => ({
  fetchPopularVideosApi: vi.fn(),
}))

// The shared VideoSearchInput loads blank-input panels (history +
// trending); canned empty lists keep the invoke mock out of the picture
// (same pattern as the video-search page tests).
vi.mock('@/features/video-search/api/searchHistory', () => ({
  getSearchHistoryApi: vi.fn().mockResolvedValue([]),
  recordSearchApi: vi.fn().mockResolvedValue(undefined),
  removeSearchHistoryApi: vi.fn().mockResolvedValue([]),
  clearSearchHistoryApi: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/video-search/api/searchTrending', () => ({
  searchTrendingApi: vi.fn().mockResolvedValue([]),
}))

// Tests run without loaded translations, so accessible names are raw keys.
const PLACEHOLDER = 'videoSearch.placeholder'
const SEARCH_BUTTON = 'videoSearch.searchButton'

function Harness() {
  return (
    <Routes>
      <Route path="/popular" element={<PopularContent />} />
      {/* Real results page plus a marker: proves the handoff navigation
          AND that a failed first search keeps it mounted (its idle
          redirect would bounce back here). */}
      <Route
        path="/video-search"
        element={
          <>
            <div>video-search-route</div>
            <VideoSearchContent />
          </>
        }
      />
    </Routes>
  )
}

const feedPage = {
  page: 1,
  numResults: 0,
  numPages: 2,
  entries: [
    {
      bvid: 'BV1popular1',
      title: 'おすすめ 動画',
      cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
      author: 'up主',
      play: 1,
      duration: 42,
      typeid: '1',
      typename: 'zone',
    },
  ],
}

describe('PopularContent', () => {
  afterEach(() => vi.clearAllMocks())

  it('loads the popular feed on mount', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(feedPage)
    renderWithProviders(<Harness />, { route: '/popular' })

    expect(fetchPopularVideosApi).toHaveBeenCalledWith(1)
    expect(await screen.findByText('おすすめ 動画')).toBeInTheDocument()
    expect(document.title).toBe('popular.title - app.title')
  })

  // Must run before the handoff test below: it needs the search slice
  // still idle (results === null) so the failure under test is a FIRST
  // search. Guards the redirect's searchStarted flag — a failed first
  // search must keep /video-search mounted showing its error, not bounce
  // back here with the error swallowed.
  it('keeps /video-search mounted with the error when the first search fails', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(feedPage)
    vi.mocked(searchVideosApi).mockRejectedValue('ERR::RATE_LIMITED')
    const { user } = renderWithProviders(<Harness />, { route: '/popular' })
    await screen.findByText('おすすめ 動画')

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('video-search-route')).toBeInTheDocument()
    expect(screen.queryByText('おすすめ 動画')).not.toBeInTheDocument()
  })

  it('hands a keyword search off to /video-search', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(feedPage)
    vi.mocked(searchVideosApi).mockResolvedValue({
      page: 1,
      numResults: 1,
      numPages: 1,
      entries: feedPage.entries,
    })
    const { user } = renderWithProviders(<Harness />, { route: '/popular' })
    await screen.findByText('おすすめ 動画')

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(searchVideosApi).toHaveBeenCalledWith('少年', 1, {
      order: 'totalrank',
      duration: 0,
      tids: 0,
    })
    expect(screen.getByText('video-search-route')).toBeInTheDocument()
  })
})
