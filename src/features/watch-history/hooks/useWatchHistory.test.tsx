/**
 * useWatchHistory suite.
 *
 * Drives the fetch_watch_history command via mockInvoke, covering the
 * first-page fetch, cursor-based pagination (including the empty-page
 * isEnd guard), guards, error handling, and the filtered selectors.
 */

import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { useWatchHistory } from '@/features/watch-history/hooks/useWatchHistory'
import {
  reset as resetWatchHistory,
  setCursor,
  setEntries,
  setLoadingMore,
  setSearchQuery,
} from '@/features/watch-history/model/watchHistorySlice'
import type {
  WatchHistoryCursor,
  WatchHistoryEntry,
} from '@/features/watch-history/types'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nowSec = Math.floor(Date.now() / 1000)

const entryOf = (
  bvid: string,
  title: string,
  viewAt = nowSec,
): WatchHistoryEntry => ({
  title,
  cover: 'cover',
  bvid,
  cid: 1,
  page: 1,
  viewAt,
  duration: 60,
  progress: 10,
  url: 'url',
})

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const openCursor: WatchHistoryCursor = {
  max: 7,
  viewAt: 99,
  isEnd: false,
}

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd]
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

describe('useWatchHistory', () => {
  beforeEach(() => {
    store.dispatch(resetWatchHistory())
    store.dispatch(setUser(loggedOutUser))
    vi.clearAllMocks()
    mockCommands({})
  })

  it('fetchInitial loads the first page with max=0, viewAt=0 and hides live entries', async () => {
    mockCommands({
      fetch_watch_history: {
        entries: [entryOf('BV1', 'One'), entryOf('', 'Live stream')],
        cursor: openCursor,
      },
    })
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.fetchInitial()
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_watch_history', {
      max: 0,
      viewAt: 0,
    })
    // The live entry (empty bvid) is excluded by the selector.
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1'])
    expect(result.current.cursor).toEqual(openCursor)
    expect(result.current.loading).toBe(false)
  })

  it('fetchMore appends the next page using the cursor boundary', async () => {
    store.dispatch(setEntries([entryOf('BV1', 'One')]))
    store.dispatch(setCursor(openCursor))
    mockCommands({
      fetch_watch_history: { entries: [entryOf('BV2', 'Two')], cursor: null },
    })
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.fetchMore()
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_watch_history', {
      max: 7,
      viewAt: 99,
    })
    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV1', 'BV2'])
    expect(result.current.loadingMore).toBe(false)
  })

  it('fetchMore marks the cursor ended on an empty page instead of looping', async () => {
    store.dispatch(setEntries([entryOf('BV1', 'One')]))
    store.dispatch(setCursor(openCursor))
    const endCursor: WatchHistoryCursor = { max: 0, viewAt: 0, isEnd: false }
    mockCommands({
      fetch_watch_history: { entries: [], cursor: endCursor },
    })
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.fetchMore()
    })

    expect(result.current.entries).toHaveLength(1)
    expect(result.current.cursor?.isEnd).toBe(true)
  })

  it('fetchMore is a no-op without a cursor, at the end, or while loading more', async () => {
    // No cursor at all.
    const first = renderHookWithStore(() => useWatchHistory())
    await act(async () => {
      await first.result.current.fetchMore()
    })
    expect(mockInvoke).not.toHaveBeenCalled()
    first.unmount()

    // Cursor already at the end.
    store.dispatch(setCursor({ max: 1, viewAt: 1, isEnd: true }))
    const second = renderHookWithStore(() => useWatchHistory())
    await act(async () => {
      await second.result.current.fetchMore()
    })
    expect(mockInvoke).not.toHaveBeenCalled()
    second.unmount()

    // A load-more request is already in flight.
    store.dispatch(setCursor(openCursor))
    store.dispatch(setLoadingMore(true))
    const third = renderHookWithStore(() => useWatchHistory())
    await act(async () => {
      await third.result.current.fetchMore()
    })
    expect(mockInvoke).not.toHaveBeenCalled()
    third.unmount()
  })

  it('sets the error message when the fetch fails', async () => {
    mockCommands({ fetch_watch_history: new Error('ERR::RATE_LIMIT') })
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.fetchInitial()
    })

    expect(result.current.error).toBe('ERR::RATE_LIMIT')
    expect(result.current.loading).toBe(false)
  })

  it('leaves the error unset for an unauthorized (handled) session expiry', async () => {
    // Logged-out user: handleSessionExpiry returns early and the error is
    // swallowed, so the slice must stay null.
    // Plain-string rejection, the shape Tauri invoke actually rejects with.
    mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.fetchInitial()
    })

    expect(result.current.error).toBeNull()
  })

  it('filters entries by search query and date', async () => {
    store.dispatch(
      setEntries([entryOf('BV1', 'Alpha'), entryOf('BV2', 'Beta')]),
    )
    const { result } = renderHookWithStore(() => useWatchHistory())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))

    act(() => result.current.setSearch('alpha'))
    expect(result.current.entries.map((e) => e.title)).toEqual(['Alpha'])

    act(() => result.current.setSearch(''))
    act(() => result.current.setDate('today'))
    // Both fixtures are stamped "now", so today keeps them; a month-old
    // entry would drop out.
    const stale = entryOf('BV3', 'Old', nowSec - 40 * 24 * 3600)
    act(() => {
      store.dispatch(setEntries([entryOf('BV1', 'Alpha'), stale]))
    })
    expect(result.current.entries.map((e) => e.title)).toEqual(['Alpha'])

    expect(result.current.dateFilter).toBe('today')
  })

  it('refresh resets and refetches the first page', async () => {
    store.dispatch(setEntries([entryOf('BV1', 'Stale')]))
    store.dispatch(setSearchQuery('stale'))
    mockCommands({
      fetch_watch_history: {
        entries: [entryOf('BV9', 'Fresh')],
        cursor: openCursor,
      },
    })
    const { result } = renderHookWithStore(() => useWatchHistory())

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.entries.map((e) => e.bvid)).toEqual(['BV9'])
    expect(result.current.searchQuery).toBe('')
    expect(result.current.cursor).toEqual(openCursor)
  })
})
