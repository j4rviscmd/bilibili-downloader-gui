import { store } from '@/app/store'
import { searchVideosApi } from '@/features/video-search/api/searchVideos'
import {
  clearSearchCache,
  setResult,
} from '@/features/video-search/model/videoSearchSlice'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '@/features/video-search/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
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
      <Route path="/popular" element={<div>popular-route</div>} />
    </Routes>
  )
}

/** Mini-reproduction of PersistentPageLayout: the page stays mounted
 * (display:none) once visited, so an idle redirect that re-fires on later
 * location changes would yank the user back to /popular on every
 * navigation. */
function PersistentHarness() {
  const { pathname } = useLocation()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (pathname === '/video-search') setMounted(true)
  }, [pathname])
  return (
    <div>
      {mounted && (
        <div
          style={{ display: pathname === '/video-search' ? undefined : 'none' }}
        >
          <VideoSearchContent />
        </div>
      )}
      {pathname === '/popular' && (
        <div>
          popular-route <Link to="/downloads">go-downloads</Link>
        </div>
      )}
      {pathname === '/downloads' && <div>downloads-route</div>}
    </div>
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
      typeid: '193',
      typename: 'MV',
    },
  ],
}

// The page redirects to /popular while idle (no search yet); tests that
// exercise the search flow pre-seed a finished search so the page mounts
// active. Runs against the real singleton store, like the hook tests.
function seedFinishedSearch() {
  store.dispatch(setResult({ keyword: 'seed', page: 1, response }))
}

describe('VideoSearchContent', () => {
  afterEach(() => {
    vi.clearAllMocks()
    // Response cache must not leak responses across tests.
    store.dispatch(clearSearchCache())
  })

  // Must run before the seeded tests: it relies on the store still being
  // idle (results === null).
  it('redirects to /popular while idle (no search yet)', () => {
    renderWithProviders(<Harness />, { route: '/video-search' })
    expect(screen.getByText('popular-route')).toBeInTheDocument()
  })

  // Same idle-store requirement as the test above — must run before the
  // seeded tests. Guards the redirect implementation: <Navigate> (unlike
  // the navigate() effect) re-fires on every location change and would
  // replace the /downloads navigation with /popular.
  it('does not re-fire the idle redirect on later navigation', async () => {
    const { user } = renderWithProviders(<PersistentHarness />, {
      route: '/video-search',
    })

    // Idle visit: redirected to /popular exactly once.
    expect(await screen.findByText('popular-route')).toBeInTheDocument()

    // Navigate away with the page still mounted (display:none): the
    // hidden idle copy must stay quiet.
    await user.click(screen.getByText('go-downloads'))
    expect(await screen.findByText('downloads-route')).toBeInTheDocument()
    expect(screen.queryByText('popular-route')).not.toBeInTheDocument()
  })

  // Needs the idle-store requirement satisfied (the two tests above
  // leave the store idle); intentionally before the seeded tests so the
  // fetch is observable as URL-driven, not state-driven.
  it('fetches the keyword from the ?q= URL parameter on load', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    renderWithProviders(<Harness />, { route: '/video-search?q=少年' })

    expect(await screen.findByText('少年 官方版')).toBeInTheDocument()
    expect(searchVideosApi).toHaveBeenCalledWith(
      '少年',
      1,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
  })

  it('searches and renders results, card click navigates to /search', async () => {
    seedFinishedSearch()
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { user, store } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(await screen.findByText('少年 官方版')).toBeInTheDocument()
    expect(searchVideosApi).toHaveBeenCalledWith(
      '少年',
      1,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )

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

  it('refetches in place when resubmitting the current keyword', async () => {
    seedFinishedSearch()
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))
    expect(await screen.findByText('少年 官方版')).toBeInTheDocument()

    // Resubmitting the SAME keyword must refetch (retry path after a
    // failed search) without pushing a duplicate history entry. The input
    // keeps its draft after submit — clear it so the type() re-enters the
    // keyword fresh.
    await user.clear(screen.getByLabelText(PLACEHOLDER))
    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    expect(searchVideosApi).toHaveBeenCalledTimes(2)
    expect(searchVideosApi).toHaveBeenLastCalledWith(
      '少年',
      1,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
  })

  it('renders the no-results state for an empty result set', async () => {
    seedFinishedSearch()
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
    seedFinishedSearch()
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
    seedFinishedSearch()
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
    seedFinishedSearch()
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
