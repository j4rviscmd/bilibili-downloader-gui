import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
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
  goToPage: vi.fn(),
  searchStarted: true,
  setFilter: vi.fn(),
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
    vi.mocked(useVideoSearch).mockReturnValue({ ...baseState, loading: true })
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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

    const { user } = renderWithProviders(<VideoSearchResultList />)

    // i18n test setup returns raw keys; three cards → three play buttons.
    const playButtons = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })
    await user.click(playButtons[0])

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_preview_play_url', {
        bvid: 'BV1De411p77r',
      })
    })
    // Dialog portals to body; the resolved URL lands on the <video> src.
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'https://example.com/preview.mp4')
    })
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

  it('opens the preview from the play button without triggering the card download', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

    const { user } = renderWithProviders(<VideoSearchResultList />)

    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    expect(mockInvoke).toHaveBeenCalledWith('get_preview_play_url', {
      bvid: 'BV1De411p77r',
    })
    // The play button must stay isolated from the card's download handoff:
    // sampling a preview must not enqueue a download.
    expect(handleDownload).not.toHaveBeenCalled()
  })

  it('closing the preview unmounts the video and a reopen resolves fresh', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue('https://example.com/a.mp4')

    const { user } = renderWithProviders(<VideoSearchResultList />)
    const [playA, playB] = screen.getAllByRole('button', {
      name: 'videoSearch.previewPlay',
    })

    await user.click(playA)
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute(
        'src',
        'https://example.com/a.mp4',
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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

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

  it('shows a buffering spinner until the media reports playable', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    vi.mocked(usePendingDownload).mockReturnValue(vi.fn())
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')
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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')
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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')
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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

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
    mockInvoke.mockResolvedValue('https://example.com/preview.mp4')

    const { user } = renderWithProviders(<VideoSearchResultList />)
    await user.click(
      screen.getAllByRole('button', { name: 'videoSearch.previewPlay' })[0],
    )

    const browserButton = await screen.findByRole('button', {
      name: /videoSearch\.previewOpenInBrowser/,
    })
    await user.click(browserButton)

    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1De411p77r',
    )
    // Browser handoff keeps the dialog open — only the download
    // handoff closes it.
    expect(document.querySelector('video')).not.toBeNull()
  })
})
