import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { act, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { VideoSearchFeedTail } from './VideoSearchFeedTail'
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
  filters: DEFAULT_VIDEO_SEARCH_FILTERS,
  numPages: 2,
  numResults: 40,
  feeds: {},
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
      // Sub-zone tid (MV → music) — badge localizes via the zone map.
      typeid: '193',
      typename: 'MV',
    },
    {
      // Unknown tid — badge falls back to the raw API typename.
      bvid: 'BV1unknown9xx',
      title: '未知分区 動画',
      cover: 'https://i0.hdslb.com/bfs/archive/y.jpg',
      author: '別UP',
      play: 1,
      duration: 10,
      typeid: '9999',
      typename: '未知分区',
    },
    {
      // Empty zone data — the badge renders nothing (hidden, not blank).
      bvid: 'BV1nozone',
      title: '無バッジ 動画',
      cover: 'https://i0.hdslb.com/bfs/archive/z.jpg',
      author: '第三UP',
      play: 2,
      duration: 33,
      typeid: '',
      typename: '',
    },
  ],
  search: vi.fn(),
  loadMore: vi.fn(),
  noMore: false,
  searchStarted: true,
  setFilter: vi.fn(),
}

// happy-dom's IntersectionObserver never computes intersections, so the
// stub records the latest instance and tests fire its callback by hand.
class StubObserver {
  static last: StubObserver | null = null
  callback: (entries: { isIntersecting: boolean }[]) => void
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(callback: StubObserver['callback']) {
    this.callback = callback
    StubObserver.last = this
  }
}

/** Harness giving the list a real scroll-root element via ref. */
function ScrollHarness() {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={scrollRef}>
      <VideoSearchResultList scrollRootRef={scrollRef} />
    </div>
  )
}

/** happy-dom's default userAgent tracks the host platform, which would
 * make the buffering-spinner platform gate host-dependent. Stub it so
 * each spinner test states its platform explicitly. */
describe('VideoSearchResultList', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders entry fields and click hands off to the download flow', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)

    const { user } = renderWithProviders(<VideoSearchResultList />)

    expect(screen.getByText('少年 官方版')).toBeInTheDocument()
    expect(screen.getByText('up主')).toBeInTheDocument()
    // Zone badges: known sub-zone tid localizes (raw key in tests), the
    // unknown-tid entry falls back to the raw API typename.
    expect(screen.getByText('videoSearch.zones.music')).toBeInTheDocument()
    expect(screen.getByText('未知分区')).toBeInTheDocument()
    // Empty zone data hides the badge entirely — exactly two badges render.
    expect(
      screen.getAllByText(/^videoSearch\.zones\.|^未知分区$/),
    ).toHaveLength(2)
    // Duration renders as a thumbnail overlay badge (media-card convention).
    expect(screen.getByText('4:47')).toBeInTheDocument()
    expect(screen.getByText('1,037,655')).toBeInTheDocument()
    // Why: hdslb.com 403s cross-origin referers — the no-referrer policy is
    // what makes covers load (regression: initial release shipped without
    // it). alt="" makes the img presentational (no role), so query directly.
    expect(document.querySelector('img')).toHaveAttribute(
      'referrerPolicy',
      'no-referrer',
    )
    await user.click(screen.getByRole('button', { name: /少年 官方版/ }))
    // Favorites pattern: no cid — resolved later by the URL search page.
    expect(handleDownload).toHaveBeenCalledWith('BV1De411p77r', null, 1)
  })

  it('renders card skeletons with an accessible busy state while loading', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      loading: true,
      entries: [],
    })
    const { container } = renderWithProviders(<VideoSearchResultList />)

    // Skeletons are aria-hidden decoration; the busy text carries the state.
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.loading')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    )
    expect(
      screen.queryByRole('button', { name: /少年/ }),
    ).not.toBeInTheDocument()
  })

  it('keeps the loaded cards and spins at the tail while fetching more', () => {
    vi.mocked(useVideoSearch).mockReturnValue({ ...baseState, loading: true })
    const { container } = renderWithProviders(<VideoSearchResultList />)

    expect(screen.getByText('少年 官方版')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.loading')).toBeInTheDocument()
    // Sentinel still mounted: the next page can auto-load.
    expect(container.querySelector('.h-px')).toBeInTheDocument()
  })

  it('shows a tail error row with retry when a later page fails', async () => {
    const loadMore = vi.fn()
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      error: 'ERR::RATE_LIMITED',
      loadMore,
    })
    const { user } = renderWithProviders(<VideoSearchResultList />)

    expect(screen.getByText('videoSearch.loadError')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'videoSearch.retry' }))
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('auto-loads the next page when the sentinel enters view', async () => {
    const loadMore = vi.fn()
    vi.mocked(useVideoSearch).mockReturnValue({ ...baseState, loadMore })
    vi.stubGlobal('IntersectionObserver', StubObserver)
    renderWithProviders(<ScrollHarness />)

    await act(async () => {
      StubObserver.last!.callback([{ isIntersecting: true }])
    })
    expect(loadMore).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('drops the sentinel at the last page (no more auto-loading)', () => {
    vi.mocked(useVideoSearch).mockReturnValue({ ...baseState, noMore: true })
    const { container } = renderWithProviders(<VideoSearchResultList />)

    expect(container.querySelector('.h-px')).not.toBeInTheDocument()
  })

  it('renders the no-results state with a hint after searching', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      entries: [],
      numResults: 0,
    })
    renderWithProviders(<VideoSearchResultList />)
    // i18n test setup returns raw keys.
    expect(screen.getByText('videoSearch.noResults')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.noResultsHint')).toBeInTheDocument()
  })

  it('renders the prompt placeholder state before any search', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      keyword: '',
      entries: [],
      numResults: 0,
    })
    renderWithProviders(<VideoSearchResultList />)
    expect(screen.getByText('videoSearch.placeholder')).toBeInTheDocument()
    expect(
      screen.queryByText('videoSearch.noResultsHint'),
    ).not.toBeInTheDocument()
  })

  it('opens an inline preview dialog from the thumbnail play button', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(undefined)

    const { user } = renderWithProviders(<VideoSearchResultList />)

    // i18n test setup returns raw keys; three cards → three play buttons.
    const playButtons = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })
    await user.click(playButtons[0])

    // The overlay window opens over the placeholder rect (double rAF
    // after mount — jsdom runs it on the next tick).
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        ([cmd]) => cmd === 'open_preview_player',
      )
      expect(calls).toHaveLength(1)
      expect(calls[0][1].bvid).toBe('BV1De411p77r')
      expect(calls[0][1].rect).toMatchObject({
        x: expect.any(Number),
        width: expect.any(Number),
      })
    })
    // The official player lives in its own overlay window: no <video>
    // element is mounted in the dialog.
    expect(document.querySelector('video')).toBeNull()
  })

  it('opens the preview from the play button without triggering the card download', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)
    mockInvoke.mockResolvedValue(undefined)

    const { user } = renderWithProviders(<VideoSearchResultList />)

    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'open_preview_player',
        expect.objectContaining({ bvid: 'BV1De411p77r' }),
      )
    })
    // The play button must stay isolated from the card's download handoff:
    // sampling a preview must not enqueue a download.
    expect(handleDownload).not.toHaveBeenCalled()
  })

  it('hands off to the download flow from the preview dialog', async () => {
    const handleDownload = vi.fn()
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)
    mockInvoke.mockResolvedValue(undefined)

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    // Same handoff as clicking the card body: no cid, page 1.
    const downloadButton = await screen.findByRole('button', {
      name: /videoSearch\.previewDownload/,
    })
    await user.click(downloadButton)

    expect(handleDownload).toHaveBeenCalledWith('BV1De411p77r', null, 1)
    // Closing the dialog takes the overlay window down with it.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('close_preview_player')
    })
  })

  it('opens the video page in the browser from the preview dialog', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(undefined)

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const browserButton = await screen.findByRole('button', {
      name: /videoSearch\.previewOpenInBrowser/,
    })
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'open_preview_player',
        expect.objectContaining({ bvid: 'BV1De411p77r' }),
      )
    })
    // History is file-global here (no reset between tests) — clear so
    // the no-close assertion below sees only this handoff's window.
    mockInvoke.mockClear()

    await user.click(browserButton)

    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1De411p77r',
    )
    // The dialog stays up: the overlay is only paused, so the browser
    // is the only thing playing the video (no double audio).
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('pause_preview_player')
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('close_preview_player')
  })
})

describe('VideoSearchFeedTail', () => {
  it('spins for an in-flight refetch of a zero-result feed', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      entries: [],
      loading: true,
    })
    const { container } = renderWithProviders(<VideoSearchFeedTail />)

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.loading')).toBeInTheDocument()
    expect(screen.queryByText('videoSearch.noResults')).not.toBeInTheDocument()
  })

  it('renders nothing for a failed page-1 refetch (the Alert owns it)', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      entries: [],
      error: 'ERR::RATE_LIMITED',
    })
    const { container } = renderWithProviders(<VideoSearchFeedTail />)

    expect(container).toBeEmptyDOMElement()
  })
})
