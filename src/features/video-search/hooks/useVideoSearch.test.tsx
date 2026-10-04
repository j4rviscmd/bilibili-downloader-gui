import { store } from '@/app/store'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchVideosApi } from '../api/searchVideos'
import { setFilter, setResult } from '../model/videoSearchSlice'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { useVideoSearch } from './useVideoSearch'

vi.mock('../api/searchVideos', () => ({
  searchVideosApi: vi.fn(),
}))

const response = {
  page: 1,
  numResults: 40,
  numPages: 2,
  entries: [],
}

describe('useVideoSearch', () => {
  afterEach(() => {
    vi.clearAllMocks()
    // Singleton store: the setFilter tests below must not leak into the
    // default-filters assertions of the other tests.
    store.dispatch(setFilter(DEFAULT_VIDEO_SEARCH_FILTERS))
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
    expect(result.current.entries).toEqual([])
    expect(result.current.keyword).toBe('kw')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('ignores blank keywords', () => {
    const { result } = renderHookWithStore(() => useVideoSearch())
    result.current.search('   ')
    expect(searchVideosApi).not.toHaveBeenCalled()
  })

  it('ignores goToPage before the first search (no keyword yet)', () => {
    // The singleton store persists across tests — reset the last keyword.
    store.dispatch(setResult({ keyword: '', page: 1, response }))
    const { result } = renderHookWithStore(() => useVideoSearch())
    result.current.goToPage(2)
    expect(searchVideosApi).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('goToPage fetches the requested page for the current keyword', async () => {
    vi.mocked(searchVideosApi).mockResolvedValue(response)
    const { result } = renderHookWithStore(() => useVideoSearch())

    result.current.search('kw')
    await vi.waitFor(() => {
      expect(result.current.keyword).toBe('kw')
    })

    vi.mocked(searchVideosApi).mockResolvedValue({ ...response, page: 2 })
    result.current.goToPage(2)
    await vi.waitFor(() => {
      expect(result.current.page).toBe(2)
    })

    expect(searchVideosApi).toHaveBeenLastCalledWith(
      'kw',
      2,
      DEFAULT_VIDEO_SEARCH_FILTERS,
    )
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
