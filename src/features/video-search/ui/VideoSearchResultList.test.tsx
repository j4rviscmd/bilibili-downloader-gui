import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { logger } from '@/shared/lib/logger'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewSessionInfo } from '../api/previewSession'
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

/** PreviewSessionInfo the backend returns from open_preview_session. */
const previewSession = (
  token: string,
  durationSec = 120,
  cappedAtSec = 120,
): PreviewSessionInfo => ({
  token,
  playlist: `hls/${token}/playlist.m3u8`,
  durationSec,
  cappedAtSec,
})

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
function stubUserAgent(ua: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua)
}

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

describe('VideoSearchResultList', () => {
  // The global store persists across tests in a file — reset the preview
  // audio settings so the volume-restore test does not leak into others.
  beforeEach(() => {
    store.dispatch(
      setSettings({ previewVolume: undefined, previewMuted: undefined }),
    )
  })

  // Restores the userAgent spies stubbed by stubUserAgent.
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
    mockInvoke.mockResolvedValue(previewSession('opens1'))

    const { user } = renderWithProviders(<VideoSearchResultList />)

    // i18n test setup returns raw keys; three cards → three play buttons.
    const playButtons = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })
    await user.click(playButtons[0])

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('open_preview_session', {
        bvid: 'BV1De411p77r',
      })
    })
    // Dialog portals to body; the resolved URL lands on the <video> src.
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    await waitFor(() => {
      expect(video).toHaveAttribute(
        'src',
        'http://stream.localhost/hls%2Fopens1%2Fplaylist.m3u8',
      )
    })
    // The native overflow (⋮) menu must not offer a Download item; the
    // dialog's own download handoff is the intended path.
    expect(video).toHaveAttribute('controlslist', 'nodownload')
  })

  it('shows a mapped error when the preview URL cannot be resolved', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockRejectedValue('ERR::NO_STREAM')

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    // ERR::NO_STREAM maps to the video.no_stream key (raw key in tests).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'video.no_stream',
    )
    expect(document.querySelector('video')).toBeNull()
  })

  it('overrides video_not_found with the preview-specific unavailable message', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    // Deleted/private/region-blocked videos still surface in search
    // results; the view API refuses them with -404 → ERR::VIDEO_NOT_FOUND.
    mockInvoke.mockRejectedValue('ERR::VIDEO_NOT_FOUND')

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    // The global video.video_not_found message ("check the URL") does not
    // fit a search-result entry — the preview must show its own key.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('videoSearch.previewVideoUnavailable')
    expect(alert).not.toHaveTextContent('video.video_not_found')
    expect(document.querySelector('video')).toBeNull()
  })

  it('opens the preview from the play button without triggering the card download', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)
    mockInvoke.mockResolvedValue(previewSession('nodl1'))

    const { user } = renderWithProviders(<VideoSearchResultList />)

    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    expect(mockInvoke).toHaveBeenCalledWith('open_preview_session', {
      bvid: 'BV1De411p77r',
    })
    // The play button must stay isolated from the card's download handoff:
    // sampling a preview must not enqueue a download.
    expect(handleDownload).not.toHaveBeenCalled()
  })

  it('closing the preview unmounts the video and a reopen resolves fresh', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('reopen1'))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    const [playA, playB] = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })

    await user.click(playA)
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute(
        'src',
        'http://stream.localhost/hls%2Freopen1%2Fplaylist.m3u8',
      )
    })

    // Escape dismisses the dialog → onClose resets the entry → the <video>
    // unmounts, which is what actually stops playback.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('video')).toBeNull()

    // Reopening another card while its fetch is pending must show the
    // skeleton — the previous entry's URL must not bleed in.
    mockInvoke.mockImplementation(() => new Promise<string>(() => {}))
    await user.click(playB)
    expect(document.querySelector('video')).toBeNull()
  })

  it('falls back to the stripped raw message for unmapped error codes', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockRejectedValue('ERR::SOME_UNMAPPED_CODE')

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    // Unmapped code → raw message with the ERR:: prefix stripped.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'SOME_UNMAPPED_CODE',
    )
  })

  it('restores the last-used volume and muted state on the video', async () => {
    store.dispatch(setSettings({ previewVolume: 0.3, previewMuted: true }))
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('vol0'))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // Applied after mount via the restore effect — not the native 1.0
    // default of a freshly created element.
    await waitFor(() => {
      expect(video.volume).toBe(0.3)
      expect(video.muted).toBe(true)
    })
  })

  it('persists volume changes through a debounced settings patch', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('vol1'))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // Simulate the user moving the volume slider in native controls. The
    // save is debounced (real timers — 500ms elapses naturally, keeping
    // the shared userEvent instance usable).
    video.volume = 0.7
    fireEvent.volumeChange(video)

    await waitFor(
      () => {
        expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
          patch: { previewVolume: 0.7, previewMuted: false },
        })
      },
      { timeout: 2000 },
    )
    // The store is updated in the same tick as the patch dispatch.
    expect(store.getState().settings.previewVolume).toBe(0.7)
  })

  it('replaces a failed media load with an error message, not a black player', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    // Proxy path shape: the backend returns `preview/{token}` and the
    // component feeds it through convertFileSrc (mocked in setup.ts).
    mockInvoke.mockResolvedValue(previewSession('deadbeef01'))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // CDN fetch dies inside the <video> element (URL itself resolved fine).
    // The first error triggers the one-shot re-resolve (dead CDN draws are
    // common; a fresh token usually lands on a healthy edge), so the
    // failure UI only appears on the SECOND error. The spy keeps plugin-log
    // quiet; jsdom fires `error` without a MediaError, hence
    // code/msg=undefined.
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    fireEvent.error(video)

    // The retry unmounts the dead element and mounts a fresh one.
    const retried = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      expect(el).not.toBe(video)
      return el as HTMLVideoElement
    })
    fireEvent.error(retried)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'videoSearch.previewPlaybackError',
    )
    expect(document.querySelector('video')).toBeNull()
    // MediaError code + preview path must reach app.log — the proxy + BE
    // resolved fine, so this line is the only attribution for intermittent
    // playback failures.
    expect(errorSpy).toHaveBeenCalledWith(
      'VideoPreviewDialog: media error code=undefined msg=undefined playlist=hls/deadbeef01/playlist.m3u8',
    )
    errorSpy.mockRestore()
  })

  it('recovers from a dead CDN draw via the one-shot re-resolve', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    // First draw is a dead edge, the retry draw is healthy. Dispatch by
    // command: a bare mockResolvedValueOnce queue is consumed by ANY
    // invoke call, including the close_preview_session that precedes the
    // retry's open.
    let openCalls = 0
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'open_preview_session') return Promise.resolve(undefined)
      openCalls += 1
      return Promise.resolve(
        previewSession(openCalls === 1 ? 'dead1' : 'alive1'),
      )
    })
    // History accumulates across tests in this file — count only this
    // test's resolves (clear keeps the queued implementations).
    mockInvoke.mockClear()

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const first = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    fireEvent.error(first)

    // The re-resolved token replaces the src (mocked convertFileSrc
    // percent-encodes the path) and no failure UI shows. Exactly two
    // resolves happened: initial + retry.
    const second = await waitFor(() => {
      const el = document.querySelector('video') as HTMLVideoElement
      expect(el).toHaveAttribute(
        'src',
        'http://stream.localhost/hls%2Falive1%2Fplaylist.m3u8',
      )
      return el
    })
    expect(
      mockInvoke.mock.calls.filter(([cmd]) => cmd === 'open_preview_session'),
    ).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(second).not.toBe(first)
    vi.mocked(logger.error).mockRestore()
  })

  it('drops a one-shot retry result that lands after the entry switched', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    // Preview resolves in order: entry A initial → entry A retry (pending
    // until released) → entry B after the switch.
    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let releaseRetry!: (v: PreviewSessionInfo) => void
    let previewCalls = 0
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'open_preview_session') return Promise.resolve(undefined)
      previewCalls += 1
      if (previewCalls === 1) {
        return Promise.resolve(previewSession('a1'))
      }
      if (previewCalls === 2) {
        return new Promise((resolve) => {
          releaseRetry = resolve
        })
      }
      return Promise.resolve(previewSession('b1'))
    })

    const { user } = renderWithProviders(<VideoSearchResultList />)
    const [playA, playB] = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })

    await user.click(playA)
    const first = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // Error → the one-shot retry for A goes in flight (stays pending).
    fireEvent.error(first)

    // The open modal blocks pointer events on the list (Radix overlay) —
    // close A, then open B. A's retry is still pending across the switch,
    // which is exactly the race under test.
    fireEvent.keyDown(document, { key: 'Escape' })
    await user.click(playB)
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute(
        'src',
        'http://stream.localhost/hls%2Fb1%2Fplaylist.m3u8',
      )
    })

    // A's retry resolves LAST — it must not overwrite B's preview.
    await act(async () => {
      releaseRetry(previewSession('stale1'))
    })
    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      'http://stream.localhost/hls%2Fb1%2Fplaylist.m3u8',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.mocked(logger.error).mockRestore()
  })

  it('shows a buffering spinner until the media reports playable', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('buf1'))
    // macOS has no native buffering spinner — the custom one must show.
    stubUserAgent(MAC_UA)

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // Mount → loading starts; spinner overlays the video area.
    fireEvent.loadStart(video)
    const spinner = await waitFor(() => {
      const svg = document.querySelector('.aspect-video .animate-spin')
      expect(svg).not.toBeNull()
      return svg as Element
    })

    // First playable frame → spinner hides.
    fireEvent.canPlay(video)
    await waitFor(() => {
      expect(spinner.isConnected).toBe(false)
    })
  })

  it('hides the buffering spinner on Windows', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('buf2'))
    // Windows WebView2 native controls already render their own spinner.
    stubUserAgent(WINDOWS_UA)

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    fireEvent.loadStart(video)
    fireEvent.waiting(video)
    // fireEvent flushes the re-render, so a wrongly-shown overlay would
    // already be in the DOM here.
    expect(document.querySelector('.aspect-video .animate-spin')).toBeNull()
  })

  it('shows the spinner for a seek started while paused', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('buf3'))
    // Seek-while-paused spinner is likewise macOS/Linux-only.
    stubUserAgent(MAC_UA)

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // A seek while paused fires seeking/seeked but NOT waiting (spec) —
    // the pair must carry the spinner on its own.
    fireEvent.seeking(video)
    await waitFor(() => {
      expect(
        document.querySelector('.aspect-video .animate-spin'),
      ).not.toBeNull()
    })

    fireEvent.seeked(video)
    await waitFor(() => {
      expect(document.querySelector('.aspect-video .animate-spin')).toBeNull()
    })
  })

  it('hands off to the download flow from the preview dialog', async () => {
    const handleDownload = vi.fn()
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)
    mockInvoke.mockResolvedValue(previewSession('dl1'))

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
    // Closing the dialog stops playback before navigating.
    await waitFor(() => {
      expect(document.querySelector('video')).toBeNull()
    })
  })

  it('opens the video page in the browser from the preview dialog', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue(previewSession('open1'))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const browserButton = await screen.findByRole('button', {
      name: /videoSearch\.previewOpenInBrowser/,
    })
    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    const pauseSpy = vi.spyOn(video, 'pause')
    await user.click(browserButton)

    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1De411p77r',
    )
    // Playback pauses before the browser opens the same video (no double
    // audio); the dialog itself stays open — only the download handoff
    // closes it.
    expect(pauseSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelector('video')).not.toBeNull()
  })

  it('opens the video page in the browser while the preview is still resolving', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    // Never-settling invoke pins the dialog to its skeleton state: no
    // <video> is mounted yet, so videoRef.current is null in the handler
    // (manual executor — tsconfig lib < es2024 has no withResolvers).
    mockInvoke.mockReturnValue(new Promise(() => {}))

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const browserButton = await screen.findByRole('button', {
      name: /videoSearch\.previewOpenInBrowser/,
    })
    // The null branch of videoRef.current?.pause() must be a no-op —
    // the handoff proceeds with no mounted video to pause.
    await user.click(browserButton)

    expect(document.querySelector('video')).toBeNull()
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1De411p77r',
    )
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
