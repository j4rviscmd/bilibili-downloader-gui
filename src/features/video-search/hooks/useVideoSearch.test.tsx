import { store } from '@/app/store'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchVideosApi } from '../api/searchVideos'
import {
  clearFeeds,
  clearSearchCache,
  setError,
  setFilter,
  setLoading,
  setResult,
} from '../model/videoSearchSlice'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { useVideoSearch } from './useVideoSearch'

vi.mock('../api/searchVideos', () => ({
  searchVideosApi: vi.fn(),
}))
const entry = (bvid: string) => ({
  bvid,
  title: `title ${bvid}`,
  cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
  author: 'up主',
  play: 1,
  duration: 42,
  typeid: '1',
  typename: 'zone',
})
const response = {
  page: 1,
  numResults: 40,
  numPages: 2,
  entries: [entry('BV1')],
}
const response2 = {
  page: 2,
  numResults: 40,
  numPages: 2,
  entries: [entry('BV2')],
}

/** Singleton store: return the search slice to its pre-first-search idle
 * state between tests, so waitFor assertions cannot pass vacuously on a
 * previous test's results (keyword '' and empty cards). */
function resetSearchState() {
  store.dispatch(
    setResult({
      keyword: '',
      page: 1,
      response: { page: 1, numResults: 0, numPages: 0, entries: [] },
    }),
  )
  store.dispatch(setError(null))
  store.dispatch(setLoading(false))
}

describe('useVideoSearch', () => {
  afterEach(() => {
    vi.clearAllMocks()
    // Singleton store: the setFilter tests below must not leak into the
    // default-filters assertions of the other tests.
    store.dispatch(setFilter(DEFAULT_VIDEO_SEARCH_FILTERS))
    // Results must not leak across tests either (see resetSearchState).
    resetSearchState()
    // Response cache must not leak responses across tests.
    store.dispatch(clearSearchCache())
    // Nor the per-keyword feed stack (the restore path would skip fetches).
    store.dispatch(clearFeeds())
  })

  it('search stores the response and resets to page 1', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.numResults).toBe(40)
    })

    expect(searchVideosApi).toHaveBeenCalledWith(
      'kw',
      1,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
    expect(result.current.entries).toEqual(response.entries)
    expect(result.current.keyword).toBe('kw')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('ignores blank keywords', () => {
    const { result } = renderHookWithStore(() => useVideoSearch())
    result.current.search('   ')
    expect(searchVideosApi).not.toHaveBeenCalled()
  })

  it('ignores loadMore before the first search (no keyword yet)', () => {
    // The singleton store persists across tests — reset the last keyword.
    store.dispatch(setResult({ keyword: '', page: 1, response }))
    const { result } = renderHookWithStore(() => useVideoSearch())
    result.current.loadMore()
    expect(searchVideosApi).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('loadMore fetches the next page and appends its cards', async () => {
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(response2)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })

    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.page).toBe(2)
    })

    expect(searchVideosApi).toHaveBeenLastCalledWith(
      'kw',
      2,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
    expect(result.current.entries).toEqual([
      ...response.entries,
      ...response2.entries,
    ])
    expect(result.current.noMore).toBe(true)
  })

  it('loadMore is a no-op past the last page', async () => {
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(response2)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })
    // numPages is 2: load both pages, then the feed ends.
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.noMore).toBe(true)
    })

    result.current.loadMore()
    expect(searchVideosApi).toHaveBeenCalledTimes(2)
  })

  it('ignores loadMore while the next page is already in flight', async () => {
    let resolvePage2!: (r: typeof response2) => void
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolvePage2 = r
          }),
      )
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    // A second sentinel hit while the page-2 fetch is pending: the
    // loading guard must not start a duplicate request.
    result.current.loadMore()
    expect(searchVideosApi).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolvePage2(response2)
    })
  })

  it('loadMore retries a failed page by re-requesting it', async () => {
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce('ERR::RATE_LIMITED')
      .mockResolvedValueOnce(response2)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.error).toBe('ERR::RATE_LIMITED')
    })
    // The loaded cards survive the failed fetch.
    expect(result.current.entries).toEqual(response.entries)

    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.page).toBe(2)
    })
    expect(searchVideosApi).toHaveBeenLastCalledWith(
      'kw',
      2,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
    expect(result.current.error).toBeNull()
  })

  it('clears accumulated cards when a new search starts', async () => {
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(response2)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.page).toBe(2)
    })

    // New keyword with the page-1 fetch in flight: the old keyword's
    // cards must not linger (the list shows its skeleton instead).
    let resolveOther!: (r: typeof response) => void
    vi.mocked(searchVideosApi).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOther = r
        }),
    )
    await act(async () => {
      result.current.search('other')
    })
    expect(result.current.entries).toEqual([])
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveOther({ ...response, entries: [entry('BV9')] })
    })
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual([entry('BV9')])
    })
  })

  it('search restores a visited keyword from the stack without refetching', async () => {
    // Local 3-page fixtures: the shared `response` pair ends at page 2,
    // which would make the restored feed complete (noMore) and defeat
    // the continues-from-depth assertion below.
    const p1 = { page: 1, numResults: 40, numPages: 3, entries: [entry('BV1')] }
    const p2 = { page: 2, numResults: 40, numPages: 3, entries: [entry('BV2')] }
    const other = {
      page: 1,
      numResults: 40,
      numPages: 3,
      entries: [entry('BX')],
    }
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(p1)
      .mockResolvedValueOnce(p2)
      .mockResolvedValueOnce(other)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(p1.entries)
    })
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.page).toBe(2)
    })

    result.current.search('other')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual([entry('BX')])
    })

    // Back to 'kw': synchronous stack restore — no API call, both loaded
    // pages back, and the feed continues from where it left off.
    await act(async () => {
      result.current.search('kw')
    })
    expect(result.current.page).toBe(2)
    expect(result.current.entries).toEqual([...p1.entries, ...p2.entries])
    expect(searchVideosApi).toHaveBeenCalledTimes(3)

    const p3 = { page: 3, numResults: 40, numPages: 3, entries: [entry('BV3')] }
    vi.mocked(searchVideosApi).mockResolvedValueOnce(p3)
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.page).toBe(3)
    })
    expect(searchVideosApi).toHaveBeenLastCalledWith(
      'kw',
      3,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
  })

  it('fresh search bypasses the stacked feed restore', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.entries).toEqual(response.entries)
    })

    // Same-keyword resubmit: intentional refresh — refetch page 1 even
    // though the keyword is stacked.
    result.current.search('kw', { fresh: true })
    expect(searchVideosApi).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale response that resolves after a newer search', async () => {
    // Slow request for 'slow' hangs until resolved manually; 'fast' settles.
    let resolveSlow!: (v: typeof response) => void
    const slow = new Promise<typeof response>((r) => (resolveSlow = r))
    vi.mocked(searchVideosApi)
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce({ ...response, numResults: 7 })

    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('slow')
    result.current.search('fast')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('fast')
      expect(result.current.numResults).toBe(7)
    })

    // The stale 'slow' response resolves last — it must not clobber 'fast'.
    await act(async () => {
      resolveSlow({ ...response, numResults: 999 })
    })
    expect(result.current.keyword).toBe('fast')
    expect(result.current.numResults).toBe(7)
    expect(result.current.loading).toBe(false)
  })

  it('stores the error string on failure', async () => {
    vi.mocked(searchVideosApi).mockRejectedValue('ERR::RATE_LIMITED')
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.error).toBe('ERR::RATE_LIMITED')
    })

    expect(result.current.loading).toBe(false)
    // mockInvoke stays unused — the api module is mocked directly.
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('ignores a stale rejection that lands after a newer search', async () => {
    // Slow request for 'slow' rejects after 'fast' already succeeded — the
    // stale error must not clobber the good result with an error screen.
    let rejectSlow!: (e: string) => void
    const slow = new Promise<typeof response>((_, rej) => (rejectSlow = rej))
    vi.mocked(searchVideosApi)
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce(response)

    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('slow')
    result.current.search('fast')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('fast')
      expect(result.current.error).toBeNull()
    })

    await act(async () => {
      rejectSlow('ERR::RATE_LIMITED')
    })
    expect(result.current.keyword).toBe('fast')
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('setFilter re-runs the last keyword at page 1 with merged filters', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue({ ...response, page: 3 })
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })
    // Position beyond page 1 so the reset back to page 1 is observable.
    store.dispatch(setResult({ keyword: 'kw', page: 3, response }))

    result.current.setFilter({ order: 'click', tids: 4 })
    await vi.waitFor(() => {
      expect(result.current.filters).toEqual({
        order: 'click',
        duration: 0,
        tids: 4,
      })
    })

    expect(searchVideosApi).toHaveBeenLastCalledWith('kw', 1, {
      order: 'click',
      duration: 0,
      tids: 4,
    })
  })

  it('setFilter only updates state before the first search (no re-run)', async () => {
    store.dispatch(setResult({ keyword: '', page: 1, response }))
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.setFilter({ duration: 2 })

    // The selector view re-renders async — wait for the patched filters.
    await vi.waitFor(() => {
      expect(result.current.filters).toEqual({
        order: 'totalrank',
        duration: 2,
        tids: 0,
      })
    })
    expect(searchVideosApi).not.toHaveBeenCalled()
  })
})

describe('useVideoSearch response cache', () => {
  afterEach(() => {
    vi.clearAllMocks()
    store.dispatch(setFilter(DEFAULT_VIDEO_SEARCH_FILTERS))
    resetSearchState()
    store.dispatch(clearSearchCache())
    store.dispatch(clearFeeds())
  })

  it('reuses a cached response instead of refetching (history back/forward)', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })
    result.current.search('other')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('other')
    })

    // Back to the first keyword: served from the cache, no new request.
    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })
    expect(searchVideosApi).toHaveBeenCalledTimes(2)
  })

  it('fresh search bypasses the cache', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })

    result.current.search('kw', { fresh: true })
    await vi.waitFor(() => {
      expect(searchVideosApi).toHaveBeenCalledTimes(2)
    })
  })

  it('a cache hit cancels an in-flight slower loadMore', async () => {
    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveSlow!: (r: typeof response) => void
    vi.mocked(searchVideosApi)
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSlow = res
          }),
      )
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })

    // Page-2 loadMore hangs; the cached page 1 must restore it instantly
    // AND make the late page-2 response a no-op.
    result.current.loadMore()
    await vi.waitFor(() => {
      expect(result.current.loading).toBe(true)
    })
    await act(async () => {
      result.current.search('kw')
    })
    expect(result.current.page).toBe(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.entries).toEqual(response.entries)

    await act(async () => {
      resolveSlow(response2)
    })
    expect(result.current.page).toBe(1)
    expect(result.current.entries).toEqual(response.entries)
    expect(result.current.loading).toBe(false)
  })
})
