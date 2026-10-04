import { searchVideosApi } from '@/features/video-search/api/searchVideos'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoSearchContent } from './index'

vi.mock('@/features/video-search/api/searchVideos', () => ({
  searchVideosApi: vi.fn(),
}))

// Tests run without loaded translations, so accessible names are raw keys.
const PLACEHOLDER = 'videoSearch.placeholder'
const SEARCH_BUTTON = 'videoSearch.searchButton'

function Harness() {
  return (
    <Routes>
      <Route path="/video-search" element={<VideoSearchContent />} />
      <Route path="/search" element={<div>search-route</div>} />
    </Routes>
  )
}

const response = {
  page: 1,
  numResults: 1,
  numPages: 1,
  entries: [
    {
      bvid: 'BV1De411p77r',
      title: '少年 官方版',
      cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
      author: 'up主',
      play: 1,
      duration: 287,
    },
  ],
}

describe('VideoSearchContent', () => {
  afterEach(() => vi.clearAllMocks())

  it('searches and renders results, card click navigates to /search', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { user, store } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(await screen.findByText('少年 官方版')).toBeInTheDocument()
    expect(searchVideosApi).toHaveBeenCalledWith('少年', 1)

    await user.click(screen.getByRole('button', { name: /少年 官方版/ }))
    // Handed off to the URL search page (download flow).
    expect(screen.getByText('search-route')).toBeInTheDocument()
    // Pending download dispatched for the clicked video (no cid — favorites
    // pattern; the URL search page resolves it).
    expect(store.getState().input.pendingDownload).toMatchObject({
      bvid: 'BV1De411p77r',
      cid: null,
      page: 1,
    })
  })

  it('renders the no-results state for an empty result set', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue({
      page: 1,
      numResults: 0,
      numPages: 0,
      entries: [],
    })
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })
    await user.type(screen.getByLabelText(PLACEHOLDER), 'kw')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(await screen.findByText('videoSearch.noResults')).toBeInTheDocument()
  })

  it('submits via the Enter key and ignores a blank keyword', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    // Blank draft: Enter fires the form submit, but the hook's blank guard
    // must keep it from reaching the backend.
    await user.type(screen.getByLabelText(PLACEHOLDER), '   {enter}')
    expect(searchVideosApi).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年{enter}')
    expect(await screen.findByText('少年 官方版')).toBeInTheDocument()
  })

  it('shows a mapped error alert on failure', async () => {
    vi.mocked(searchVideosApi).mockRejectedValue('ERR::RATE_LIMITED')
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })
    await user.type(screen.getByLabelText(PLACEHOLDER), 'kw')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    // mapBackendError maps ERR::RATE_LIMITED to the video.rate_limited key.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('falls back to the raw message for unmapped error codes', async () => {
    // ERR::SEARCH_KEYWORD_EMPTY has no entry in mapBackendError, so the
    // page must strip the ERR:: prefix instead of showing the raw code.
    vi.mocked(searchVideosApi).mockRejectedValue('ERR::SEARCH_KEYWORD_EMPTY')
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })
    await user.type(screen.getByLabelText(PLACEHOLDER), 'kw')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'SEARCH_KEYWORD_EMPTY',
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent('ERR::')
  })
})
