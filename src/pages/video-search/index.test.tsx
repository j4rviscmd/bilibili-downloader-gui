import { store } from '@/app/store'
import { searchVideosApi } from '@/features/video-search/api/searchVideos'
import {
  clearFeeds,
  clearSearchCache,
  setError,
  setFilter,
  setResult,
} from '@/features/video-search/model/videoSearchSlice'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '@/features/video-search/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoSearchContent } from './index'

vi.mock('@/features/video-search/api/searchVideos', () => ({
  searchVideosApi: vi.fn(),
}))

vi.mock('@/features/video-search/api/searchSuggest', () => ({
  searchSuggestApi: vi.fn().mockResolvedValue([]),
}))

// The suggest panels call these on focus/submit; factories return settled
// empty results so the page tests exercise the search flow only.
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

/** Distinct content from `response`: with stacked per-keyword feeds both
 * stay mounted, so shared titles would break single-match assertions. */
const seededResponse = {
  ...response,
  entries: [
    { ...response.entries[0], bvid: 'BVseeded0000', title: 'シード動画' },
  ],
}

// The page redirects to /popular while idle (no search yet); tests that
// exercise the search flow pre-seed a finished search so the page mounts
// active. Runs against the real singleton store, like the hook tests.
function seedFinishedSearch() {
  store.dispatch(
    setResult({ keyword: 'seed', page: 1, response: seededResponse }),
  )
}

describe('VideoSearchContent', () => {
  afterEach(() => {
    vi.clearAllMocks()
    // Response cache must not leak responses across tests.
    store.dispatch(clearSearchCache())
    // Nor the per-keyword feed stack (restore path would skip fetches).
    store.dispatch(clearFeeds())
    // Nor a tail-error state (set by the later-page failure test below).
    store.dispatch(setError(null))
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

  it('keeps a later-page failure out of the top alert (tail error row owns it)', () => {
    seedFinishedSearch()
    // Deep-scroll shape: page-1 cards already accumulated, the page-2
    // fetch failed — error set with the entries intact.
    store.dispatch(setError('ERR::RATE_LIMITED'))
    renderWithProviders(<Harness />, { route: '/video-search' })

    // Loaded cards stay, the tail error row owns recovery, and the top
    // Alert stays hidden (it would sit outside the viewport mid-scroll).
    expect(screen.getByText('シード動画')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.loadError')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not scroll on a keyword switch; a filter change returns to the top', async () => {
    seedFinishedSearch()
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { user } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })
    const scrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo')

    // A new keyword renders in its own stacked container that starts at
    // the top by itself — no programmatic scrolling, so every keyword's
    // container keeps its scroll position across switches.
    await user.type(screen.getByLabelText(PLACEHOLDER), '少年')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))
    await waitFor(() => {
      expect(searchVideosApi).toHaveBeenCalledWith(
        '少年',
        1,
        DEFAULT_VIDEO_SEARCH_FILTERS,
      )
    })
    expect(scrollTo).not.toHaveBeenCalled()

    // A filter change replaces the active feed's cards in place → top.
    store.dispatch(setFilter({ order: 'click' }))
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    })
  })

  it('keeps a visited keyword stacked with its cards while viewing another', async () => {
    seedFinishedSearch()
    const other = {
      ...response,
      entries: [
        {
          ...response.entries[0],
          bvid: 'BVother0000',
          title: '別キーワード動画',
        },
      ],
    }
    vi.mocked(searchVideosApi).mockResolvedValue(other)
    const { user, container } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    await user.type(screen.getByLabelText(PLACEHOLDER), '別')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))
    await waitFor(() => {
      expect(screen.getByText('別キーワード動画')).toBeInTheDocument()
    })

    // Both feeds stay mounted: the visited one hidden with its own scroll
    // container (cards and scroll position intact), the active one visible.
    const scrollers = [...container.querySelectorAll('.overflow-y-auto')]
    expect(scrollers.length).toBe(2)
    const [seeded, active] = scrollers as HTMLDivElement[]
    expect(seeded).toHaveStyle({ display: 'none' })
    expect(seeded).toHaveTextContent('シード動画')
    expect(active).not.toHaveStyle({ display: 'none' })
    expect(active).toHaveTextContent('別キーワード動画')
  })

  it('hides the visited feed before a new keyword fetch resets state', async () => {
    seedFinishedSearch()
    // The new keyword's page-1 fetch never settles: the reset window
    // (entries cleared, slice keyword still the old one) stays open for
    // the whole test.
    vi.mocked(searchVideosApi).mockImplementationOnce(
      () => new Promise<typeof response>(() => {}),
    )
    const { user, container } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    await user.type(screen.getByLabelText(PLACEHOLDER), '次')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))

    // The URL drives the container switch synchronously: the visited
    // container must already be hidden with its stored cards, so the
    // fetch's skeleton never swaps into it (which would clamp its scroll
    // position away).
    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    })
    const [seeded, active] = [
      ...container.querySelectorAll('.overflow-y-auto'),
    ] as HTMLDivElement[]
    expect(seeded).toHaveStyle({ display: 'none' })
    expect(seeded).toHaveTextContent('シード動画')
    expect(seeded.querySelector('[aria-busy="true"]')).toBeNull()
    expect(active).not.toHaveStyle({ display: 'none' })
    expect(active.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('reuses the stacked card DOM across keyword switches (no thumbnail reload)', async () => {
    seedFinishedSearch()
    const other = {
      ...response,
      entries: [
        { ...response.entries[0], bvid: 'BVother0001', title: '別件動画' },
      ],
    }
    vi.mocked(searchVideosApi).mockResolvedValue(other)
    const { user, container } = renderWithProviders(<Harness />, {
      route: '/video-search',
    })

    // The container node itself is keyed and stable across switches —
    // capture it once and compare the <img> inside it before/after.
    const seededEl = [...container.querySelectorAll('.overflow-y-auto')].find(
      (el) => (el as HTMLElement).textContent?.includes('シード動画'),
    ) as HTMLDivElement
    const img = seededEl.querySelector('img')
    expect(img).not.toBeNull()

    // Switch to another keyword, then back via a resubmit (restore path).
    await user.type(screen.getByLabelText(PLACEHOLDER), '別')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))
    await waitFor(() => {
      expect(screen.getByText('別件動画')).toBeInTheDocument()
    })
    await user.clear(screen.getByLabelText(PLACEHOLDER))
    await user.type(screen.getByLabelText(PLACEHOLDER), 'seed')
    await user.click(screen.getByRole('button', { name: SEARCH_BUTTON }))
    await waitFor(() => {
      expect(screen.getByText('シード動画')).toBeVisible()
    })

    // SAME <img> node: React reconciled the grid at its stable position,
    // so the browser keeps the decoded thumbnails. A remount (component
    // type swap at the container's child slot) would recreate every
    // <img> and reload each cover.
    expect(seededEl.querySelector('img')).toBe(img)
  })
})
