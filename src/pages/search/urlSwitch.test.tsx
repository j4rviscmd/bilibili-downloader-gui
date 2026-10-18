import { store } from '@/app/store'
import { setInitiated } from '@/features/init'
import { setUser } from '@/features/user/userSlice'
import { resetVideo, setVideo } from '@/features/video'
import {
  initPartInputs,
  resetVideoView,
  setInput,
  updatePartInputByIndex,
} from '@/features/video/model/inputSlice'
import type { Video, VideoPart } from '@/features/video/types'
import SearchContent from '@/pages/search'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Heavy leaves are stubbed; VideoForm1 stays REAL because this file drives
// the actual URL input (the switch test needs real typing + submit).
vi.mock('@/features/video/ui/VideoPartCard', () => ({
  default: ({ page }: { page: number }) => (
    <div data-testid="video-part-card">part {page}</div>
  ),
}))
vi.mock('@/features/video/ui/VideoPartCardSkeleton', () => ({
  default: () => <div data-testid="part-skeleton" />,
}))
vi.mock('@/features/video/ui/DownloadButton', () => ({
  default: () => <div data-testid="download-button" />,
}))
vi.mock('@/features/video-search/ui/VideoPreviewDialog', () => ({
  VideoPreviewDialog: () => null,
}))
vi.mock('@/features/login', () => ({
  QRCodeLoginDialog: () => <div data-testid="qr-login-dialog" />,
  QRCodeDisplay: () => null,
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function makePart(index: number): VideoPart {
  return {
    part: `Part ${index + 1}`,
    defaultTitle: `Test Video Part ${index + 1}`,
    page: index + 1,
    cid: 1000 + index,
    duration: 60,
    videoQualities: [],
    audioQualities: [],
    thumbnail: { url: '' },
    subtitles: [],
  }
}

function makeVideo(partCount: number, bvid = 'BV1test'): Video {
  return {
    title: 'Test Video',
    bvid,
    parts: Array.from({ length: partCount }, (_, i) => makePart(i)),
    isLimitedQuality: false,
    contentType: 'video',
  }
}

/** Count of fetch_video_info invokes so far — the no-refetch oracle
 * shared by every history-walk test below. */
const fetchVideoInfoCalls = () =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'fetch_video_info').length

describe('URL switch fetching state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(setInitiated(true))
    store.dispatch(
      setUser({
        code: 0,
        message: '',
        ttl: 0,
        data: {
          uname: '',
          isLogin: false,
          wbiImg: { imgUrl: '', subUrl: '' },
        },
        hasCookie: false,
      }),
    )
    store.dispatch(
      setInput({
        url: '',
        partInputs: [],
        pendingDownload: null,
        batchSettings: {
          videoQuality: null,
          audioQuality: null,
          subtitle: null,
        },
        homePage: 1,
      }),
    )
    const video = makeVideo(3)
    store.dispatch(setVideo(video))
    store.dispatch(
      initPartInputs(
        video.parts.map((p) => ({
          cid: p.cid,
          page: p.page,
          title: p.part,
          videoQuality: '',
          audioQuality: '',
          selected: false,
          duration: p.duration,
        })),
      ),
    )
    store.dispatch(
      setInput({
        url: 'https://www.bilibili.com/video/BV1test',
        partInputs: [],
        pendingDownload: null,
        batchSettings: {
          videoQuality: null,
          audioQuality: null,
          subtitle: null,
        },
        homePage: 1,
      }),
    )
  })

  it('swaps the stale video for the skeleton while a different video is fetched', async () => {
    // Hang the fetch so the in-flight state stays observable. (Plain
    // executor: the project's TS lib target lacks Promise.withResolvers.)
    const hang = new Promise<never>(() => {})
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'fetch_video_info' ? hang : Promise.resolve(undefined),
    )

    const { user, container } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    // Video A loaded → its parts are on screen.
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)

    // Submit a different video's URL → the page must swap A's content for
    // the skeleton (mockup state B) instead of keeping A visible until B
    // lands.
    const input = container.querySelector<HTMLInputElement>('#url')
    if (!input) throw new Error('URL input not rendered')
    await user.clear(input)
    await user.type(input, 'https://www.bilibili.com/video/BV1other')
    await user.keyboard('{Enter}')

    await vi.waitFor(() => {
      expect(screen.queryAllByTestId('video-part-card')).toHaveLength(0)
    })
    // The fetching view is the skeleton layout (LoaderSkeleton renders
    // plain Skeleton blocks rather than the part-card skeleton).
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    )
  })

  it('back/forward walks empty ⇄ fetched video, restoring edits without a refetch', async () => {
    // Production first visit: an empty store — the beforeEach seed would
    // itself push a history entry at mount and add a hop to the walk.
    store.dispatch(resetVideoView())
    store.dispatch(resetVideo())
    const urlA = 'https://www.bilibili.com/video/BV1first'
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'fetch_video_info')
        return Promise.resolve(makeVideo(2, 'BV1first'))
      return Promise.resolve(undefined)
    })

    const { user, container } = renderWithProviders(<SearchNavHarness />, {
      route: '/search',
    })

    // Fetch video A through the real input engine (explicit submit).
    const input = container.querySelector<HTMLInputElement>('#url')
    if (!input) throw new Error('URL input not rendered')
    await user.clear(input)
    await user.type(input, urlA)

    // The landed video pushed its history entry (?url=…).
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toContain('url='),
    )
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(2)

    // Let the input engine's post-submit debounce (500ms silent fetch of
    // the same URL, RTK cache hit) settle before editing, so the edit is
    // the last write. (Plain executor: the project's TS lib target lacks
    // Promise.withResolvers — same note as the hanging fetch above.)
    await new Promise((resolve) => setTimeout(resolve, 650))
    store.dispatch(updatePartInputByIndex({ index: 0, title: 'renamed' }))
    const fetchesAfterLoad = fetchVideoInfoCalls()

    // Back → the empty page: hero view, no part cards, store unloaded.
    await user.click(screen.getByText('nav-back'))
    await vi.waitFor(() =>
      expect(screen.queryAllByTestId('video-part-card')).toHaveLength(0),
    )
    expect(store.getState().input.partInputs).toHaveLength(0)

    // Forward → instant snapshot restore: parts AND the edit are back,
    // without a refetch.
    await user.click(screen.getByText('nav-forward'))
    await vi.waitFor(() =>
      expect(screen.getAllByTestId('video-part-card')).toHaveLength(2),
    )
    expect(store.getState().input.partInputs[0]?.title).toBe('renamed')
    expect(fetchVideoInfoCalls()).toBe(fetchesAfterLoad)
  })

  it('walks multiple entries: back restores the previous video (and its edits) without a refetch', async () => {
    store.dispatch(resetVideoView())
    store.dispatch(resetVideo())
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'fetch_video_info') return Promise.resolve(undefined)
      // Respond with the video for the URL the engine just committed —
      // fresh bvids so snapshots from earlier tests cannot satisfy a
      // restore in place of a real fetch.
      const { url } = store.getState().input
      return Promise.resolve(
        url.includes('BV1beta')
          ? makeVideo(3, 'BV1beta')
          : makeVideo(2, 'BV1alpha'),
      )
    })

    const { user, container } = renderWithProviders(<SearchNavHarness />, {
      route: '/search',
    })
    const input = container.querySelector<HTMLInputElement>('#url')
    if (!input) throw new Error('URL input not rendered')

    // Video A lands and records its entry.
    await user.clear(input)
    await user.type(input, 'https://www.bilibili.com/video/BV1alpha')
    await user.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toContain(
        'BV1alpha',
      ),
    )
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(2)
    // Same settle as the traversal test: the post-submit silent re-fetch
    // must finish before the edit, so the edit is the mirrored state.
    await new Promise((resolve) => setTimeout(resolve, 650))
    store.dispatch(updatePartInputByIndex({ index: 0, title: 'renamed A' }))

    // Video B lands on top and records its own entry. Re-query the
    // input: the hero → compact switch remounts VideoForm1, so the
    // earlier element reference is detached (user.clear would fail to
    // focus it).
    const inputB = container.querySelector<HTMLInputElement>('#url')
    if (!inputB) throw new Error('URL input not rendered')
    await user.clear(inputB)
    await user.type(inputB, 'https://www.bilibili.com/video/BV1beta')
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toContain(
        'BV1beta',
      ),
    )
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
    await new Promise((resolve) => setTimeout(resolve, 650))
    const fetchesAfterLoad = fetchVideoInfoCalls()

    // Back → A's entry: instant snapshot restore swaps B's parts for A's,
    // A's edit included, with no fetch of either video.
    await user.click(screen.getByText('nav-back'))
    await vi.waitFor(() =>
      expect(screen.getAllByTestId('video-part-card')).toHaveLength(2),
    )
    expect(screen.getByTestId('search-echo').textContent).toContain('BV1alpha')
    expect(store.getState().input.partInputs[0]?.title).toBe('renamed A')

    // Forward → B's entry restores B the same way.
    await user.click(screen.getByText('nav-forward'))
    await vi.waitFor(() =>
      expect(screen.getAllByTestId('video-part-card')).toHaveLength(3),
    )
    expect(fetchVideoInfoCalls()).toBe(fetchesAfterLoad)
  })

  it('does not retry a ?url= entry whose fetch already failed this mount', async () => {
    store.dispatch(resetVideoView())
    store.dispatch(resetVideo())
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'fetch_video_info') return Promise.resolve(undefined)
      return store.getState().input.url.includes('BV1gone')
        ? Promise.reject(new Error('gone'))
        : Promise.resolve(makeVideo(2, 'BV1good'))
    })

    // Enter through the failed entry itself (shared link / restored tab):
    // the mount attempts it once and reports the failure.
    const badUrl = 'https://www.bilibili.com/video/BV1gone'
    const { user, container } = renderWithProviders(<SearchNavHarness />, {
      route: `/search?url=${encodeURIComponent(badUrl)}`,
    })
    await vi.waitFor(() => expect(fetchVideoInfoCalls()).toBe(1))
    await vi.waitFor(() =>
      expect(vi.mocked(toast.error).mock.calls.length).toBeGreaterThan(0),
    )
    expect(screen.queryAllByTestId('video-part-card')).toHaveLength(0)

    // A working URL typed on top lands and records its entry.
    const input = container.querySelector<HTMLInputElement>('#url')
    if (!input) throw new Error('URL input not rendered')
    await user.clear(input)
    await user.type(input, 'https://www.bilibili.com/video/BV1good')
    await user.keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(screen.getAllByTestId('video-part-card')).toHaveLength(2),
    )
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toContain(
        'BV1good',
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 650))
    const fetchesAfterLoad = fetchVideoInfoCalls()

    // Back onto the failed entry: known-failed URLs are not re-attempted —
    // the loaded video stays (no wipe, no retry loop).
    await user.click(screen.getByText('nav-back'))
    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toContain(
        'BV1gone',
      ),
    )
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(2)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(fetchVideoInfoCalls()).toBe(fetchesAfterLoad)
  })

  it('keeps the loaded video while another page is active (hidden copy does not sync)', async () => {
    // beforeEach seeded a landed BV1test; mounting on its own entry keeps
    // the sync effect in its already-synced early return.
    const seededUrl = 'https://www.bilibili.com/video/BV1test'
    const { user } = renderWithProviders(<PersistentSearchHarness />, {
      route: `/search?url=${encodeURIComponent(seededUrl)}`,
    })
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
    expect(fetchVideoInfoCalls()).toBe(0)

    // Leave for another page: the persistent layout keeps this page
    // mounted while searchParams describe the OTHER page's location.
    await user.click(screen.getByText('nav-other'))
    await vi.waitFor(() =>
      expect(screen.getByTestId('loc-echo').textContent).toBe('/other'),
    )
    // The hidden copy must not sync against the foreign location: video,
    // part inputs and url survive untouched, and the other page's
    // location is not stamped with a junk ?url=.
    expect(store.getState().video.parts).toHaveLength(3)
    // This file's beforeEach seeding ends with setInput(partInputs: []) —
    // the rendered cards come from video.parts — so "untouched" here
    // means still empty, not three.
    expect(store.getState().input.partInputs).toHaveLength(0)
    expect(store.getState().input.url).toBe(seededUrl)
    expect(fetchVideoInfoCalls()).toBe(0)

    // Returning re-activates the page with the video intact — no refetch.
    await user.click(screen.getByText('nav-back'))
    await vi.waitFor(() =>
      expect(screen.getByTestId('loc-echo').textContent).toContain('/search'),
    )
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
    expect(fetchVideoInfoCalls()).toBe(0)
  })
})

/** /search with history controls + a location echo, so back/forward
 * round-trips through the page's ?url= entries are observable. */
function SearchNavHarness() {
  const navigate = useNavigate()
  const { search } = useLocation()
  return (
    <Routes>
      <Route
        path="/search"
        element={
          <>
            <SearchContent />
            <div data-testid="search-echo">{search}</div>
            <button onClick={() => navigate(-1)}>nav-back</button>
            <button onClick={() => navigate(1)}>nav-forward</button>
          </>
        }
      />
    </Routes>
  )
}

/** Persistent-layout shape: /search stays mounted (the app shell merely
 * hides it) while another route is active, so the page's effects observe
 * a foreign pathname — the hidden-copy hazard the sync guard protects. */
function PersistentSearchHarness() {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  return (
    <>
      <SearchContent />
      <div data-testid="loc-echo">{pathname + search}</div>
      <button onClick={() => navigate('/other')}>nav-other</button>
      <button onClick={() => navigate(-1)}>nav-back</button>
      <Routes>
        <Route path="/search" element={null} />
        <Route path="/other" element={<div data-testid="other-page" />} />
      </Routes>
    </>
  )
}
