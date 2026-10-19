import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { store } from '@/app/store'
import { setUser, type User } from '@/features/user'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import type { VideoSearchEntry } from '../types'

// `cachedEntries` is module-scoped, so each test re-imports a fresh module
// via `vi.resetModules()` + dynamic import to control the cache lifetime
// (same pattern as src/shared/os/api/getOs.test.ts).
async function importFresh() {
  vi.resetModules()
  return import('./useHomeRecommendations')
}

// The hook gates on the live nav-API user state (Firefox logins never
// populate the login slice's session), so tests seed the user slice.
const loggedInUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: 'u', isLogin: true, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: true,
}
const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

function entry(bvid: string) {
  return {
    bvid,
    title: `t-${bvid}`,
    cover: 'https://i0.hdslb.com/bfs/a.jpg',
    author: 'up',
    play: 1,
    duration: 60,
    typeid: '',
    typename: '',
  }
}

describe('useHomeRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    store.dispatch(setUser(loggedOutUser))
  })

  it('fetches once when logged in and exposes entries', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke.mockResolvedValue([entry('BV1a'), entry('BV1b')])
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(mockInvoke).toHaveBeenCalledWith('fetch_home_recommendations')
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1a', 'BV1b'])
    expect(result.current.showSkeleton).toBe(false)
  })

  it('does not fetch and shows no skeleton when logged out', async () => {
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(result.current.entries).toEqual([])
    expect(result.current.showSkeleton).toBe(false)
  })

  it('degrades a rejection to an empty hidden shelf', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke.mockRejectedValue(new Error('boom'))
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(result.current.entries).toEqual([])
    expect(result.current.showSkeleton).toBe(false)
  })

  it('serves a remount from the module cache without a second invoke', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke.mockResolvedValue([entry('BV1cached')])
    const { useHomeRecommendations } = await importFresh()

    const first = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())
    expect(first.result.current.entries[0]?.bvid).toBe('BV1cached')
    first.unmount()

    // Remount (transient → stacked container handover): cached, no refetch.
    const second = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(second.result.current.entries[0]?.bvid).toBe('BV1cached')
  })

  it('dedupes concurrent mounts into one fetch', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke.mockResolvedValue([entry('BV1one')])
    const { useHomeRecommendations } = await importFresh()

    // The page mounts two hook instances in one commit (shelf + heading
    // gate) — the shared in-flight promise keeps it a single request.
    const first = renderHookWithStore(useHomeRecommendations)
    const second = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(first.result.current.entries[0]?.bvid).toBe('BV1one')
    expect(second.result.current.entries[0]?.bvid).toBe('BV1one')
    first.unmount()
    second.unmount()
  })

  it('refresh re-fetches and swaps in the new list', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockResolvedValueOnce([entry('BV1new')])
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    await act(() => result.current.refresh())

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1new'])
    expect(result.current.refreshing).toBe(false)
  })

  it('keeps the previous entries when a refresh result is empty', async () => {
    // Backend failure shape: any error degrades to an empty list, never a
    // rejection — swapping it in would wipe the shelf and its button.
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockResolvedValueOnce([])
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    await act(() => result.current.refresh())

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1old'])
  })

  it('keeps the module cache intact when a refresh result is empty', async () => {
    // The cache write sits *after* the empty-check and outside the catch,
    // so a failed refresh must leave the cached list alone — otherwise a
    // remount (transient → stacked handover) would show an empty shelf
    // and drop the refresh button.
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockResolvedValueOnce([])
    const { useHomeRecommendations } = await importFresh()

    const first = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())
    await act(() => first.result.current.refresh())
    first.unmount()

    const second = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(second.result.current.entries.map((e) => e.bvid)).toEqual(['BV1old'])
  })

  it('keeps the previous entries when the refresh request rejects', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockRejectedValueOnce(new Error('boom'))
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    await act(() => result.current.refresh())

    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1old'])
    expect(result.current.refreshing).toBe(false)
  })

  it('flags refreshing while the refresh request is in flight', async () => {
    store.dispatch(setUser(loggedInUser))
    let settle: (value: VideoSearchEntry[]) => void = () => {}
    mockInvoke.mockResolvedValueOnce([entry('BV1old')]).mockImplementationOnce(
      () =>
        new Promise<VideoSearchEntry[]>((resolve) => {
          settle = resolve
        }),
    )
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    let refreshed!: Promise<void>
    act(() => {
      refreshed = result.current.refresh()
    })
    expect(result.current.refreshing).toBe(true)

    await act(async () => {
      settle([entry('BV1new')])
      await refreshed
    })
    expect(result.current.refreshing).toBe(false)
    expect(result.current.entries[0]?.bvid).toBe('BV1new')
  })

  it('dedupes concurrent refresh calls into one request', async () => {
    store.dispatch(setUser(loggedInUser))
    let settle: (value: VideoSearchEntry[]) => void = () => {}
    mockInvoke.mockResolvedValueOnce([entry('BV1old')]).mockImplementationOnce(
      () =>
        new Promise<VideoSearchEntry[]>((resolve) => {
          settle = resolve
        }),
    )
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.refresh()
      // Same tick: the shelf's button is disabled while refreshing, but
      // the page's title icon bypasses that guard — one request only.
      second = result.current.refresh()
    })

    await act(async () => {
      settle([entry('BV1new')])
      await Promise.all([first, second])
    })
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1new'])
  })

  it('releases the in-flight guard after a rejected refresh', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([entry('BV1new')])
    const { useHomeRecommendations } = await importFresh()

    const { result } = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    await act(() => result.current.refresh())
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1old'])

    // The guard must clear in `finally`, or a retry after a failure
    // would silently no-op forever.
    await act(() => result.current.refresh())
    expect(mockInvoke).toHaveBeenCalledTimes(3)
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1new'])
  })

  it('seeds the module cache so a remount shows the refreshed list', async () => {
    store.dispatch(setUser(loggedInUser))
    mockInvoke
      .mockResolvedValueOnce([entry('BV1old')])
      .mockResolvedValueOnce([entry('BV1new')])
    const { useHomeRecommendations } = await importFresh()

    const first = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())
    await act(() => first.result.current.refresh())
    first.unmount()

    // Transient → stacked handover: cached refresh result, no third fetch.
    const second = renderHookWithStore(useHomeRecommendations)
    await act(() => Promise.resolve())

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(second.result.current.entries[0]?.bvid).toBe('BV1new')
  })
})
