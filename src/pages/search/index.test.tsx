import { store } from '@/app/store'
import { setInitiated } from '@/features/init'
import { setUser } from '@/features/user/userSlice'
import { PARTS_PER_PAGE, setVideo } from '@/features/video'
import { initPartInputs, setInput } from '@/features/video/model/inputSlice'
import type { Video, VideoPart } from '@/features/video/types'
import SearchContent from '@/pages/search'
import { renderWithProviders } from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
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
  default: ({
    page,
    onThumbnailClick,
  }: {
    page: number
    onThumbnailClick: () => void
  }) => (
    <div data-testid="video-part-card">
      part {page}
      <button onClick={onThumbnailClick}>open-preview</button>
    </div>
  ),
}))
// The shared preview dialog is a leaf covered by its own tests; the
// stub echoes the props the page wires (target entry, hidden download,
// close) so the composition stays observable here.
vi.mock('@/features/video-search/ui/VideoPreviewDialog', () => ({
  VideoPreviewDialog: ({
    entry,
    onClose,
    showDownload,
  }: {
    entry: { bvid: string; title: string; page?: number } | null
    onClose: () => void
    showDownload?: boolean
  }) =>
    entry ? (
      <div data-testid="preview-dialog">
        {entry.bvid}|{entry.title}|p{entry.page}
        {showDownload === false ? '|no-download' : ''}
        <button onClick={onClose}>close-preview</button>
      </div>
    ) : null,
}))
vi.mock('@/features/video/ui/VideoPartCardSkeleton', () => ({
  default: () => <div data-testid="part-skeleton" />,
}))
vi.mock('@/features/login', () => ({
  QRCodeLoginDialog: () => <div data-testid="qr-login-dialog" />,
  QRCodeDisplay: () => <div data-testid="qr-code-display" />,
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
      <Route path="/" element={<Navigate to="/search" replace />} />
      <Route path="/search" element={<SearchContent />} />
      <Route path="/init" element={<div>init-route</div>} />
    </Routes>
  )
}

/** /search route with an echo of the search string so URL rewrites are observable. */
function HomeWithSearchEcho() {
  const { search } = useLocation()
  return (
    <Routes>
      <Route
        path="/search"
        element={
          <>
            <SearchContent />
            <div data-testid="search-echo">{search}</div>
          </>
        }
      />
    </Routes>
  )
}

describe('SearchContent', () => {
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
    renderWithProviders(<SearchContent />, { route: '/search' })

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

    renderWithProviders(<SearchContent />, { route: '/search' })

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

    renderWithProviders(<SearchContent />, { route: '/search' })

    expect(screen.queryByText('video.step2_title')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('video-part-card')).toHaveLength(0)
    expect(screen.queryAllByTestId('download-button')).toHaveLength(0)
  })

  it('renders the part list and download affordances from the store', () => {
    store.dispatch(setInput(initialInput))
    seedVideo(3)

    renderWithProviders(<SearchContent />, { route: '/search' })

    expect(screen.getByText('video.step2_title')).toBeInTheDocument()
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
    // DownloadButton mounts both in the step-2 header and the list footer.
    expect(screen.getAllByTestId('download-button')).toHaveLength(2)
    // 3 parts fit one page → no pagination controls.
    expect(
      screen.queryByText('video.pagination_previous'),
    ).not.toBeInTheDocument()
  })

  it('opens the shared preview dialog for the clicked part, without a download action', async () => {
    store.dispatch(setInput(initialInput))
    seedVideo(3)

    const { user } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    // Part 2 (list index 1): the thumbnail click must carry the video
    // bvid, the part name as title and the 1-indexed page into the
    // page-owned dialog.
    const secondCard = screen.getAllByTestId('video-part-card')[1]!
    await user.click(
      within(secondCard).getByRole('button', { name: 'open-preview' }),
    )

    const dialog = screen.getByTestId('preview-dialog')
    expect(dialog).toHaveTextContent('BV1test|Part 2|p2')
    // The download handoff would navigate back to this very page, so
    // the page mounts the dialog with the download action hidden.
    expect(dialog).toHaveTextContent('|no-download')

    // onClose clears the target again (the dialog stays mounted, gated
    // on a null entry).
    await user.click(
      within(dialog).getByRole('button', { name: 'close-preview' }),
    )
    expect(screen.queryByTestId('preview-dialog')).toBeNull()
  })

  it('paginates the part list and persists the page in the store', async () => {
    store.dispatch(setInput(initialInput))
    seedVideo(PARTS_PER_PAGE + 2)

    const { user } = renderWithProviders(<SearchContent />, {
      route: '/search?someParam=1',
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

    const { user } = renderWithProviders(<SearchContent />, {
      route: '/search',
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

    renderWithProviders(<SearchContent />, {
      route: `/search?autoFetch=${encodeURIComponent(url)}`,
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

  it('strips a stale page param when a ?p= URL lands in the store', async () => {
    store.dispatch(setInput(initialInput))
    renderWithProviders(<HomeWithSearchEcho />, { route: '/search?page=2' })

    // A multi-part URL arriving in the store invalidates the page param
    store.dispatch(
      setInput({
        ...initialInput,
        url: 'https://www.bilibili.com/video/BV1x?p=3',
      }),
    )

    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toBe(''),
    )
  })

  it('keeps other search params when stripping the stale page param', async () => {
    store.dispatch(setInput(initialInput))
    renderWithProviders(<HomeWithSearchEcho />, {
      route: '/search?page=2&foo=1',
    })

    store.dispatch(
      setInput({
        ...initialInput,
        url: 'https://www.bilibili.com/video/BV1y?p=2',
      }),
    )

    await vi.waitFor(() =>
      expect(screen.getByTestId('search-echo').textContent).toBe('?foo=1'),
    )
  })
  // ---- F-series: pagination ellipsis, confirm dialog, stale page sync ----

  it('collapses page numbers to ellipsis when there are more than 7 pages', async () => {
    seedVideo(PARTS_PER_PAGE * 8 + 1) // 9 pages

    const { user } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    const footer = screen.getByText('video.pagination_next').closest('ul')!
    // Edge pages always visible; middle pages collapsed
    expect(within(footer).getByText('1')).toBeTruthy()
    expect(within(footer).getByText('2')).toBeTruthy()
    expect(within(footer).getByText('9')).toBeTruthy()
    expect(within(footer).queryByText('5')).toBeNull()
    // Middle page collapsed behind an ellipsis marker (MoreHorizontal icon)
    expect(within(footer).queryByText('3')).toBeNull()

    // Next advances to page 2
    await user.click(within(footer).getByText('video.pagination_next'))
    expect(store.getState().input.homePage).toBe(2)
  })

  it('navigates immediately with selections kept (no confirmation dialog)', async () => {
    // Issue #691: the old dialog warned that paging would CLEAR the
    // selection — selections now persist in partInputs independent of the
    // visible page, enabling multi-page batch select → one enqueue.
    seedVideo(PARTS_PER_PAGE + 2) // 2 pages

    const { user } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    await user.click(screen.getByText('video.select_all_page'))
    const footer = screen.getByText('video.pagination_next').closest('ul')!
    await user.click(within(footer).getByText('2'))

    // No dialog; navigation is immediate…
    expect(screen.queryByText('video.confirm_navigation_title')).toBeNull()
    expect(store.getState().input.homePage).toBe(2)
    // …and the page-1 selections survive for a multi-page batch enqueue.
    expect(store.getState().input.partInputs.some((p) => p.selected)).toBe(true)
  })

  it('syncs a stale URL page param down to the last page when parts shrink', () => {
    seedVideo(3) // single page

    renderWithProviders(<SearchContent />, { route: '/search?page=9' })

    // Effect clamps the out-of-range page to totalPages (1)
    expect(store.getState().input.homePage).toBe(1)
    expect(screen.getAllByTestId('video-part-card')).toHaveLength(3)
  })

  it('renders the page content inside the full-width scroll container', () => {
    seedVideo(PARTS_PER_PAGE + 2)

    const { container } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    // Stacked Step 1 (URL input) sticks to the top INSIDE the page
    // scroller with an opaque background, so Step 2 scrolls under it
    // (classic stacking effect). The scroller spans the full inset
    // width (mirrors PageTemplate bodyScroll) wrapping the centered
    // max-w-[104rem] rail, so the scrollbar rides the window edge.
    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    const form = screen.getByTestId('video-form1')
    expect(scroller!.contains(form)).toBe(true)
    const sticky = form.closest('div.sticky')
    expect(sticky).not.toBeNull()
    expect(sticky!.className).toContain('top-0')
    expect(sticky!.className).toContain('bg-background')
    const rail = scroller!.querySelector('.max-w-\\[104rem\\]')
    expect(rail).not.toBeNull()
    expect(rail!.contains(screen.getAllByTestId('video-part-card')[0]!)).toBe(
      true,
    )
  })

  it('keeps the pagination footer sticky at the scrollport bottom', () => {
    seedVideo(PARTS_PER_PAGE + 2)

    renderWithProviders(<SearchContent />, { route: '/search' })

    // The list footer (download button + pagination) sticks to the page
    // scroller's bottom so it stays reachable while parts scroll under
    // it (same invariant as the old card-local scroll region).
    const footerButton = screen.getAllByTestId('download-button')[1]!
    const footer = footerButton.closest('div.sticky')
    expect(footer).not.toBeNull()
    expect(footer!.className).toContain('bottom-0')
    expect(footer!.textContent).toContain('video.pagination_next')
  })

  it('resets the page scroller to the top on page change', async () => {
    seedVideo(PARTS_PER_PAGE + 2)

    const { container, user } = renderWithProviders(<SearchContent />, {
      route: '/search',
    })

    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto')!
    scroller.scrollTop = 500
    const footer = screen.getByText('video.pagination_next').closest('ul')!
    await user.click(within(footer).getByText('2'))

    // performPageChange rewinds the whole-page scroller to the new
    // page's first part.
    expect(scroller.scrollTop).toBe(0)
  })

  it('scrolls the deep-linked part into view once its page settles', async () => {
    seedVideo(PARTS_PER_PAGE + 2) // 12 parts; ?p=12 targets index 11 on page 2
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo

    const { container } = renderWithProviders(<SearchContent />, {
      route: '/search?p=12',
    })

    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })
    // The reveal scrolls ONLY the page scroller (scrollElementWithin-
    // Scroller): scrollIntoView would drag the overflow-hidden app
    // shell along and strand it scrolled (no scrollbar to recover).
    // In happy-dom all rects are 0, so the computed top is just the
    // sticky/breathing offsets.
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    )
    const scroller = container.querySelector('.overflow-y-auto')!
    expect(scrollTo.mock.instances[0]).toBe(scroller)
  })
})
