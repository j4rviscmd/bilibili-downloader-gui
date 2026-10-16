import { store } from '@/app/store'
import { setInitiated } from '@/features/init'
import { setUser } from '@/features/user/userSlice'
import { setVideo } from '@/features/video'
import { initPartInputs, setInput } from '@/features/video/model/inputSlice'
import type { Video, VideoPart } from '@/features/video/types'
import SearchContent from '@/pages/search'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
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

function makeVideo(partCount: number): Video {
  return {
    title: 'Test Video',
    bvid: 'BV1test',
    parts: Array.from({ length: partCount }, (_, i) => makePart(i)),
    isLimitedQuality: false,
    contentType: 'video',
  }
}

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
})
