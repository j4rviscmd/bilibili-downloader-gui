import { store } from '@/app/store'
import { setInitiated } from '@/features/init'
import { setUser } from '@/features/user/userSlice'
import { PARTS_PER_PAGE, setVideo } from '@/features/video'
import { initPartInputs, setInput } from '@/features/video/model/inputSlice'
import type { Video, VideoPart } from '@/features/video/types'
import HomeContent from '@/pages/home'
import { renderWithProviders } from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { Navigate, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Leaf UI components are covered by their own F4 tests; here they are stubbed
// so this file locks the page's wiring (store → layout → leaves) only.
vi.mock('@/features/video/ui/VideoForm1', () => ({
  default: () => <div data-testid="video-form1" />,
}))
vi.mock('@/features/video/ui/DownloadButton', () => ({
  default: () => <div data-testid="download-button" />,
}))
vi.mock('@/features/video/ui/VideoPartCard', () => ({
  default: ({ page }: { page: number }) => (
    <div data-testid="video-part-card">part {page}</div>
  ),
}))
vi.mock('@/features/video/ui/VideoPartCardSkeleton', () => ({
  default: () => <div data-testid="part-skeleton" />,
}))
vi.mock('@/features/login', () => ({
  QRCodeLoginDialog: () => <div data-testid="qr-login-dialog" />,
  QRCodeDisplay: () => <div data-testid="qr-code-display" />,
}))
vi.mock('@/features/download-status', () => ({
  OpenDownloadStatusDialogButton: () => (
    <div data-testid="open-download-status-button" />
  ),
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const initialInput = {
  url: '',
  partInputs: [],
  pendingDownload: null,
  homePage: 1,
}

function makePart(index: number): VideoPart {
  return {
    part: `Part ${index + 1}`,
    page: index + 1,
    cid: 1000 + index,
    duration: 60,
    videoQualities: [],
    audioQualities: [],
    thumbnail: { url: '' },
    subtitles: [],
  }
}

function makeVideo(partCount: number): Video {
  return {
    title: 'Test Video',
    bvid: 'BV1test',
    parts: Array.from({ length: partCount }, (_, i) => makePart(i)),
    isLimitedQuality: false,
    contentType: 'video',
  }
}

/** Seeds the store with a fetched video and its part inputs. */
function seedVideo(partCount: number) {
  const video = makeVideo(partCount)
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
}

/** Route table with markers so the /init redirect is observable. */
function RedirectHarness() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomeContent />} />
      <Route path="/init" element={<div>init-route</div>} />
    </Routes>
  )
}

describe('HomeContent', () => {
  beforeEach(() => {
    // The store is a singleton shared across tests in this file; reset the
    // slices the page reads so each test seeds only what it asserts on.
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
      setVideo({
        title: '',
        bvid: '',
        parts: [],
        isLimitedQuality: false,
        contentType: 'video',
      }),
    )
    store.dispatch(setInput(initialInput))
  })

  it('renders the URL input card with VideoForm1 and the login notice when logged out', () => {
    renderWithProviders(<HomeContent />, { route: '/home' })

    expect(screen.getByText('video.step1_title')).toBeInTheDocument()
    expect(screen.getByTestId('video-form1')).toBeInTheDocument()
    // Default user state is logged out → the login benefits alert is shown.
    expect(screen.getByText('video.login_benefits_title')).toBeInTheDocument()
  })

  it('hides the login benefits alert once the user is logged in', () => {
    store.dispatch(
      setUser({
        code: 0,
        message: '',
        ttl: 0,
        data: {
          uname: 'tester',
          isLogin: true,
          wbiImg: { imgUrl: '', subUrl: '' },
        },
        hasCookie: true,
      }),
    )

    renderWithProviders(<HomeContent />, { route: '/home' })

    expect(
      screen.queryByText('video.login_benefits_title'),
    ).not.toBeInTheDocument()
  })

  it('hides the step 2 section while no video is loaded and not fetching', () => {
    store.dispatch(
      setVideo({
        title: '',
        bvid: '',
        parts: [],
        isLimitedQuality: false,
        contentType: 'video',
      }),
    )
    store.dispatch(setInput(initialInput))

    renderWithProviders(<HomeContent />, { route: '/home' })

    expect(screen.queryByText('video.step2_title')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('video-part-card')).toHaveLength(0)
    expect(screen.queryAllByTestId('download-button')).toHaveLength(0)
  })

  it('renders the part list and download affordances from the store', () => {
    store.dispatch(setInput(initialInput))
    seedVideo(3)

    renderWithProviders(<HomeContent />, { route: '/home' })

    expect(screen.getByText('video.step2_title')).toBeInTheDocument()
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
    // DownloadButton mounts both in the step-2 header and the list footer.
    expect(screen.getAllByTestId('download-button')).toHaveLength(2)
    // The download-status entry point is mounted by the page.
    expect(
      screen.getByTestId('open-download-status-button'),
    ).toBeInTheDocument()
    // 3 parts fit one page → no pagination controls.
    expect(
      screen.queryByText('video.pagination_previous'),
    ).not.toBeInTheDocument()
  })

  it('paginates the part list and persists the page in the store', async () => {
    store.dispatch(setInput(initialInput))
    seedVideo(PARTS_PER_PAGE + 2)

    const { user } = renderWithProviders(<HomeContent />, {
      route: '/home?someParam=1',
    })

    // Page 1 shows exactly PARTS_PER_PAGE cards of 12 total.
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(
      PARTS_PER_PAGE,
    )

    const footer = screen.getByText('video.pagination_next').closest('ul')
    expect(footer).not.toBeNull()
    // No selection → navigation is immediate, no confirmation dialog.
    await user.click(within(footer!).getByText('2'))

    expect(screen.getAllByTestId('video-part-card')).toHaveLength(2)
    // performPageChange persists the page for the sidebar Home button.
    expect(store.getState().input.homePage).toBe(2)
  })

  it('dispatches selectPageAll / deselectPageAll from the toolbar buttons', async () => {
    store.dispatch(setInput(initialInput))
    seedVideo(2)

    const { user } = renderWithProviders(<HomeContent />, {
      route: '/home',
    })

    await user.click(screen.getByText('video.select_all_page'))
    expect(store.getState().input.partInputs.every((p) => p.selected)).toBe(
      true,
    )

    await user.click(screen.getByText('video.deselect_all_page'))
    expect(store.getState().input.partInputs.some((p) => p.selected)).toBe(
      false,
    )
  })

  it('wires the autoFetch query param into onValid1 (URL lands in the store)', async () => {
    store.dispatch(setInput(initialInput))
    const url = 'https://www.bilibili.com/video/BV1autoFetch'

    renderWithProviders(<HomeContent />, {
      route: `/home?autoFetch=${encodeURIComponent(url)}`,
    })

    // onValid1 validates then dispatches setUrl before the (mocked,
    // data-less) fetch; the wiring under test is that the page forwards the
    // param into the provider's form-1 submit path.
    await vi.waitFor(() => {
      expect(store.getState().input.url).toBe(url)
    })
  })

  it('redirects to /init when the app is not initialized', async () => {
    store.dispatch(setInitiated(false))

    renderWithProviders(<RedirectHarness />, { route: '/' })

    expect(await screen.findByText('init-route')).toBeInTheDocument()
  })
})
