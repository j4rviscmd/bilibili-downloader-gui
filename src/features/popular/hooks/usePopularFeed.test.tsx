import { store } from '@/app/store'
import type { VideoSearchResponse } from '@/features/video-search'
import { fetchPopularVideosApi } from '@/features/video-search'
import { renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetFeed } from '../model/popularFeedSlice'
import { usePopularFeed } from './usePopularFeed'

vi.mock('@/features/video-search', () => ({
  fetchPopularVideosApi: vi.fn(),
}))

const page = (
  n: number,
  bvids: string[],
  noMore = false,
): VideoSearchResponse => ({
  page: n,
  numResults: 0,
  // Backend synthesizes num_pages = no_more ? page : page + 1.
  numPages: noMore ? n : n + 1,
  entries: bvids.map((bvid) => ({
    bvid,
    title: `title ${bvid}`,
    cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
    author: 'up',
    play: 1,
    duration: 60,
    typeid: '1',
    typename: 'zone',
  })),
})

describe('usePopularFeed', () => {
  afterEach(() => {
    vi.clearAllMocks()
    // Singleton store: reset the accumulated feed between tests.
    store.dispatch(resetFeed())
  })

  it('loads page 1 on mount', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(page(1, ['BV1', 'BV2']))
    const { result } = renderHookWithStore(() => usePopularFeed())

    await vi.waitFor(() => {
      expect(result.current.items.map((i) => i.bvid)).toEqual(['BV1', 'BV2'])
    })
    expect(fetchPopularVideosApi).toHaveBeenCalledWith(1)
    expect(result.current.page).toBe(1)
    expect(result.current.noMore).toBe(false)
  })

  it('loadMore appends the next page and dedupes repeated bvids', async () => {
    vi.mocked(fetchPopularVideosApi)
      .mockResolvedValueOnce(page(1, ['BV1', 'BV2']))
      .mockResolvedValueOnce(page(2, ['BV2', 'BV3']))
    const { result } = renderHookWithStore(() => usePopularFeed())
    await vi.waitFor(() => {
      expect(result.current.items).toHaveLength(2)
    })

    act(() => result.current.loadMore())
    await vi.waitFor(() => {
      expect(result.current.items.map((i) => i.bvid)).toEqual([
        'BV1',
        'BV2',
        'BV3',
      ])
    })
    expect(fetchPopularVideosApi).toHaveBeenLastCalledWith(2)
  })

  it('stops loading after no_more and ignores loadMore', async () => {
    vi.mocked(fetchPopularVideosApi).mockResolvedValue(
      page(1, ['BV1'], true /* no_more */),
    )
    const { result } = renderHookWithStore(() => usePopularFeed())
    await vi.waitFor(() => {
      expect(result.current.noMore).toBe(true)
    })

    act(() => result.current.loadMore())
    expect(fetchPopularVideosApi).toHaveBeenCalledTimes(1)
  })

  it('stores the error and retries the failed page via loadMore', async () => {
    vi.mocked(fetchPopularVideosApi)
      .mockRejectedValueOnce('ERR::RATE_LIMITED')
      .mockResolvedValueOnce(page(1, ['BV1']))
    const { result } = renderHookWithStore(() => usePopularFeed())

    await vi.waitFor(() => {
      expect(result.current.error).toBe('ERR::RATE_LIMITED')
    })
    expect(result.current.items).toHaveLength(0)

    // Retry: page is still 0, so the re-request is page 1.
    act(() => result.current.loadMore())
    await vi.waitFor(() => {
      expect(result.current.items.map((i) => i.bvid)).toEqual(['BV1'])
    })
    expect(result.current.error).toBeNull()
  })

  it('ignores loadMore while a fetch is in flight', async () => {
    // Manual deferred: tsconfig lib < es2024 has no Promise.withResolvers.
    let resolveFirst: (value: VideoSearchResponse) => void = () => {}
    const pending = new Promise<VideoSearchResponse>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(fetchPopularVideosApi)
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(page(2, ['BV2']))
    const { result } = renderHookWithStore(() => usePopularFeed())
    // Mount effect fires the first (pending) load.
    await vi.waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    act(() => result.current.loadMore())
    expect(fetchPopularVideosApi).toHaveBeenCalledTimes(1)

    act(() => resolveFirst(page(1, ['BV1'])))
    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })
})
