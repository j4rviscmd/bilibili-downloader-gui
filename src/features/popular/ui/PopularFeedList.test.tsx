import { store } from '@/app/store'
import type { VideoSearchResponse } from '@/features/video-search'
import { fetchPopularVideosApi } from '@/features/video-search'
import { renderWithProviders } from '@/test/test-utils'
import { act, screen } from '@testing-library/react'
import { type RefObject, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeed } from '../model/popularFeedSlice'
import { PopularFeedList } from './PopularFeedList'

// The real card grid pulls the preview dialog + backend hooks — replace it
// with a passthrough that exposes the entries it received. The same mock
// covers the hook's fetchPopularVideosApi import (feature index module).
vi.mock('@/features/video-search', () => ({
  VideoCardGrid: ({ entries }: { entries: { bvid: string }[] }) => (
    <ul>
      {entries.map((entry) => (
        <li key={entry.bvid}>{entry.bvid}</li>
      ))}
    </ul>
  ),
  VideoCardSkeletonGrid: () => <div>skeleton-grid</div>,
  fetchPopularVideosApi: vi.fn(),
}))

const feedPage = (page: number, bvids: string[]): VideoSearchResponse => ({
  page,
  numResults: 0,
  numPages: page + 1,
  entries: bvids.map((bvid) => ({
    bvid,
    title: `title ${bvid}`,
    cover: 'x',
    author: 'up',
    play: 1,
    duration: 60,
    typeid: '1',
    typename: 'zone',
  })),
})

/** happy-dom's IntersectionObserver never computes intersections, so the
 * stub records the latest instance and tests fire its callback by hand. */
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
function Harness() {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={scrollRef}>
      <PopularFeedList
        scrollRootRef={scrollRef as RefObject<HTMLDivElement | null>}
      />
    </div>
  )
}

describe('PopularFeedList', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', StubObserver)
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    // Singleton store: reset the accumulated feed between tests.
    store.dispatch(resetFeed())
  })

  it('renders card skeletons while the first page loads', () => {
    // Never settles: the first load stays in flight for the whole test
    // (manual executor — tsconfig lib < es2024 has no withResolvers).
    const pending = new Promise<VideoSearchResponse>(() => {})
    vi.mocked(fetchPopularVideosApi).mockImplementationOnce(() => pending)
    renderWithProviders(<Harness />)

    expect(screen.getByText('skeleton-grid')).toBeInTheDocument()
  })

  it('renders loaded entries as cards', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(
      feedPage(1, ['BV1', 'BV2']),
    )
    renderWithProviders(<Harness />)

    expect(await screen.findByText('BV1')).toBeInTheDocument()
    expect(screen.getByText('BV2')).toBeInTheDocument()
  })

  it('shows the error row with retry on a failed load', async () => {
    vi.mocked(fetchPopularVideosApi)
      .mockRejectedValueOnce('ERR::RATE_LIMITED')
      .mockResolvedValueOnce(feedPage(1, ['BV1']))
    const { user } = renderWithProviders(<Harness />)

    // Raw i18n keys — the suite runs without loaded translations.
    expect(await screen.findByText('popular.loadError')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'popular.retry' }))
    expect(await screen.findByText('BV1')).toBeInTheDocument()
  })

  it('does not auto-retry a failed page while the sentinel is visible', async () => {
    vi.mocked(fetchPopularVideosApi)
      .mockResolvedValueOnce(feedPage(1, ['BV1']))
      .mockRejectedValueOnce('ERR::RATE_LIMITED')
      .mockResolvedValueOnce(feedPage(2, ['BV2']))
    const { user } = renderWithProviders(<Harness />)
    expect(await screen.findByText('BV1')).toBeInTheDocument()

    // Sentinel enters view → auto-loads page 2 → the fetch fails.
    await act(async () => {
      StubObserver.last!.callback([{ isIntersecting: true }])
    })
    expect(await screen.findByText('popular.loadError')).toBeInTheDocument()
    expect(fetchPopularVideosApi).toHaveBeenCalledTimes(2)

    // Sentinel still in view after the failure: the observer must NOT
    // auto-retry (the error row's button owns recovery) — otherwise a
    // persistent failure would hammer the backend in a tight loop.
    await act(async () => {
      StubObserver.last!.callback([{ isIntersecting: true }])
    })
    expect(fetchPopularVideosApi).toHaveBeenCalledTimes(2)

    // Manual retry re-requests the failed page and clears the error.
    await user.click(screen.getByRole('button', { name: 'popular.retry' }))
    expect(await screen.findByText('BV2')).toBeInTheDocument()
    expect(screen.queryByText('popular.loadError')).not.toBeInTheDocument()
  })
})
