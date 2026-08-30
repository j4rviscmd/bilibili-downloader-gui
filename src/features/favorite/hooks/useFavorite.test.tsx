/**
 * useFavorite suite.
 *
 * Drives the fetch_favorite_folders / fetch_favorite_videos commands via
 * mockInvoke against the real store, covering the mount-time folder load,
 * auto-selection, pagination, refresh fallback, and the error path.
 */

import { store } from '@/app/store'
import {
  formatDuration,
  formatPlayCount,
  useFavorite,
} from '@/features/favorite/hooks/useFavorite'
import {
  reset as resetFavorite,
  setFolders as seedFolders,
  setSelectedFolder,
} from '@/features/favorite/model/favoriteSlice'
import type {
  FavoriteFolder,
  FavoriteVideo,
  FavoriteVideoListResponse,
} from '@/features/favorite/types'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastError = toast.error as unknown as Mock

const folderA: FavoriteFolder = { id: 10, title: 'Folder A', mediaCount: 1 }
const folderB: FavoriteFolder = { id: 20, title: 'Folder B', mediaCount: 2 }

const videoOf = (id: number): FavoriteVideo => ({
  id,
  bvid: `BV${id}`,
  title: `Video ${id}`,
  cover: 'cover',
  duration: 60,
  page: 1,
  upper: { mid: 1, name: 'upper', face: 'face' },
  attr: 0,
  playCount: 1,
  collectCount: 1,
  link: 'link',
})

const pageOf = (ids: number[], hasMore = false): FavoriteVideoListResponse => ({
  videos: ids.map(videoOf),
  hasMore,
  totalCount: ids.length,
})

type Handler = unknown | ((args: Record<string, unknown>) => unknown)

function mockCommands(handlers: Record<string, Handler>) {
  mockInvoke.mockImplementation(
    (cmd: string, args: Record<string, unknown>) => {
      const handler = handlers[cmd]
      const value = typeof handler === 'function' ? handler(args) : handler
      if (value instanceof Error) return Promise.reject(value)
      if (value !== undefined) return Promise.resolve(value)
      return Promise.resolve(undefined)
    },
  )
}

describe('useFavorite', () => {
  beforeEach(() => {
    store.dispatch(resetFavorite())
    vi.clearAllMocks()
    mockCommands({})
  })

  it('resets the slice when mid is null (logged out)', () => {
    store.dispatch(seedFolders([folderA]))

    renderHookWithStore(() => useFavorite(null))

    expect(store.getState().favorite.folders).toHaveLength(0)
    expect(store.getState().favorite.selectedFolderId).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('loads folders on mount, auto-selects the first, and fetches videos', async () => {
    mockCommands({
      fetch_favorite_folders: [folderA, folderB],
      fetch_favorite_videos: pageOf([1, 2]),
    })
    const { result } = renderHookWithStore(() => useFavorite(42))

    await waitFor(() => {
      expect(result.current.folders).toHaveLength(2)
    })
    await waitFor(() => {
      expect(result.current.selectedFolderId).toBe(10)
    })
    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2)
    })
    expect(mockInvoke).toHaveBeenCalledWith('fetch_favorite_folders', {
      mid: 42,
    })
    expect(mockInvoke).toHaveBeenCalledWith('fetch_favorite_videos', {
      mediaId: 10,
      pageNum: 1,
      pageSize: 20,
    })
  })

  it('skips the folder fetch when folders are already cached', async () => {
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({ fetch_favorite_videos: pageOf([1]) })

    renderHookWithStore(() => useFavorite(42))

    await waitFor(() => {
      expect(store.getState().favorite.videos).toHaveLength(1)
    })
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'fetch_favorite_folders',
      expect.anything(),
    )
  })

  it('selectFolder clears videos and refetches for the new folder', async () => {
    mockCommands({
      fetch_favorite_folders: [folderA, folderB],
      fetch_favorite_videos: pageOf([1]),
    })
    const { result } = renderHookWithStore(() => useFavorite(42))
    await waitFor(() => {
      expect(result.current.videos).toHaveLength(1)
    })

    await act(async () => {
      await result.current.selectFolder(20)
    })

    expect(mockInvoke).toHaveBeenLastCalledWith('fetch_favorite_videos', {
      mediaId: 20,
      pageNum: 1,
      pageSize: 20,
    })
  })

  it('loadMore appends the next page and increments currentPage', async () => {
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({
      fetch_favorite_videos: (args: Record<string, unknown>) =>
        args.pageNum === 1 ? pageOf([1], true) : pageOf([2, 3]),
    })
    const { result } = renderHookWithStore(() => useFavorite(42))
    await waitFor(() => {
      expect(result.current.videos.map((v) => v.id)).toEqual([1])
      expect(result.current.hasMore).toBe(true)
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_favorite_videos', {
      mediaId: 10,
      pageNum: 2,
      pageSize: 20,
    })
    expect(result.current.videos.map((v) => v.id)).toEqual([1, 2, 3])
    expect(result.current.currentPage).toBe(2)
    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore is a no-op without a selected folder, hasMore, or while loading', async () => {
    // No selected folder (cached folders keep the mount effect idle).
    store.dispatch(seedFolders([folderA]))
    const first = renderHookWithStore(() => useFavorite(42))
    await act(async () => {
      await first.result.current.loadMore()
    })
    expect(mockInvoke).not.toHaveBeenCalled()
    first.unmount()

    // Selected but hasMore false (the mount fetch returns the last page).
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({ fetch_favorite_videos: pageOf([1], false) })
    const second = renderHookWithStore(() => useFavorite(42))
    await waitFor(() => {
      expect(second.result.current.hasMore).toBe(false)
    })
    await act(async () => {
      await second.result.current.loadMore()
    })
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  it('refresh re-selects the first folder when the current one disappeared', async () => {
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({
      fetch_favorite_folders: [folderB],
      fetch_favorite_videos: pageOf([5]),
    })
    const { result } = renderHookWithStore(() => useFavorite(42))

    await act(async () => {
      await result.current.refresh()
    })

    expect(store.getState().favorite.selectedFolderId).toBe(20)
    expect(mockInvoke).toHaveBeenLastCalledWith('fetch_favorite_videos', {
      mediaId: 20,
      pageNum: 1,
      pageSize: 20,
    })
  })

  it('refresh resets the slice when no folders remain', async () => {
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({ fetch_favorite_folders: [] })
    const { result } = renderHookWithStore(() => useFavorite(42))

    await act(async () => {
      await result.current.refresh()
    })

    expect(store.getState().favorite.selectedFolderId).toBeNull()
    expect(store.getState().favorite.folders).toHaveLength(0)
  })

  it('sets the error slice and toasts when the folder fetch fails', async () => {
    mockCommands({ fetch_favorite_folders: new Error('ERR::NO_COOKIE') })
    const { result } = renderHookWithStore(() => useFavorite(42))

    await waitFor(() => {
      expect(result.current.error).toBe('ERR::NO_COOKIE')
    })
    expect(toastError).toHaveBeenCalledWith('ERR::NO_COOKIE')
    expect(result.current.foldersLoading).toBe(false)
  })

  it('swallows an unauthorized expiry silently (handled centrally)', async () => {
    mockCommands({ fetch_favorite_folders: new Error('ERR::UNAUTHORIZED') })
    const { result } = renderHookWithStore(() => useFavorite(42))

    // interceptInvokeError returns null for session expiry, so the slice
    // keeps error null and no toast fires here; loading is still reset.
    await waitFor(() => {
      expect(result.current.foldersLoading).toBe(false)
    })
    expect(result.current.error).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('records the error and toast when a loadMore page fails', async () => {
    store.dispatch(seedFolders([folderA]))
    store.dispatch(setSelectedFolder(10))
    mockCommands({
      fetch_favorite_videos: (args: Record<string, unknown>) =>
        args.pageNum === 1 ? pageOf([1], true) : new Error('ERR::API_ERROR'),
    })
    const { result } = renderHookWithStore(() => useFavorite(42))
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true)
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.error).toBe('ERR::API_ERROR')
    expect(toastError).toHaveBeenCalledWith('ERR::API_ERROR')
    // setError also clears the loading flags; the failed page is not stuck.
    expect(result.current.loading).toBe(false)
    // The videos from page 1 are preserved.
    expect(result.current.videos).toHaveLength(1)
  })

  it('refresh is a no-op when logged out', async () => {
    const { result } = renderHookWithStore(() => useFavorite(null))

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('formatDuration / formatPlayCount (pure helpers)', () => {
  it('formats minutes and seconds below one hour', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(5)).toBe('0:05')
  })

  it('formats hours once over an hour', () => {
    expect(formatDuration(3671)).toBe('1:01:11')
  })

  it('abbreviates play counts by magnitude', () => {
    expect(formatPlayCount(999)).toBe('999')
    expect(formatPlayCount(1500)).toBe('1.5K')
    expect(formatPlayCount(25000)).toBe('2.5万')
    expect(formatPlayCount(2500000)).toBe('2.5M')
  })
})
