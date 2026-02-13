/**
 * Favorite feature hooks.
 *
 * Provides custom hooks for managing Bilibili favorites.
 */

import type { RootState } from '@/app/store'
import { store } from '@/app/store'
import {
  fetchFavoriteFolders as apiFetchFolders,
  fetchFavoriteVideos as apiFetchVideos,
} from '@/features/favorite/api/favoriteApi'
import type { FavoriteVideoListResponse } from '@/features/favorite/types'
import { useCallback, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'
import {
  appendVideos,
  reset,
  setError,
  setFolders,
  setFoldersLoading,
  setLoading,
  setSelectedFolder,
  setVideos,
} from '../model/favoriteSlice'

const PAGE_SIZE = 20

/**
 * Wraps an async operation with error handling.
 *
 * Handles both Error instances and Tauri invoke string errors.
 */
async function withErrorHandling<T>(
  callback: () => Promise<T>,
  onSuccess?: (result: T) => void,
): Promise<T | null> {
  try {
    const result = await callback()
    store.dispatch(setError(null))
    onSuccess?.(result)
    return result
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'An unknown error occurred'
    store.dispatch(setError(message))
    toast.error(message)
    return null
  }
}

/**
 * Custom hook for managing Bilibili favorites.
 */
export function useFavorite(mid: number | null) {
  const state = useSelector((state: RootState) => state.favorite)

  const {
    folders,
    selectedFolderId,
    videos,
    hasMore,
    totalCount,
    currentPage,
    loading,
    foldersLoading,
    error,
  } = state

  /**
   * Fetches favorite folders on mount when mid is available.
   * Skips if folders are already cached in Redux.
   */
  useEffect(() => {
    if (!mid) {
      store.dispatch(reset())
      return
    }

    const { folders: cachedFolders } = store.getState().favorite
    if (cachedFolders.length > 0) {
      return
    }

    const loadFolders = async () => {
      store.dispatch(setFoldersLoading(true))
      const result = await withErrorHandling(
        () => apiFetchFolders(mid),
        (folders) => {
          store.dispatch(setFolders(folders))
          if (folders.length > 0 && !selectedFolderId) {
            store.dispatch(setSelectedFolder(folders[0].id))
          }
        },
      )
      if (!result) {
        store.dispatch(setFoldersLoading(false))
      }
    }

    loadFolders()
  }, [mid])

  /**
   * Fetches videos when selected folder changes.
   */
  useEffect(() => {
    if (!selectedFolderId) {
      return
    }

    store.dispatch(setLoading(true))
    withErrorHandling(
      () => apiFetchVideos(selectedFolderId, 1, PAGE_SIZE),
      (response) => {
        store.dispatch(setVideos(response))
        store.dispatch(setLoading(false))
      },
    )
  }, [selectedFolderId])

  /**
   * Selects a folder and loads its videos.
   */
  const selectFolder = useCallback((folderId: number) => {
    store.dispatch(setSelectedFolder(folderId))
  }, [])

  /**
   * Loads more videos (pagination).
   */
  const loadMore = useCallback(async () => {
    if (!selectedFolderId || !hasMore || loading) {
      return
    }

    store.dispatch(setLoading(true))
    const nextPage = currentPage + 1
    const result = await withErrorHandling(
      () => apiFetchVideos(selectedFolderId, nextPage, PAGE_SIZE),
      (response: FavoriteVideoListResponse) => {
        store.dispatch(appendVideos(response))
      },
    )
    if (result) {
      store.dispatch(setLoading(false))
    }
  }, [selectedFolderId, hasMore, loading, currentPage])

  /**
   * Refreshes both folders and videos.
   */
  const refresh = useCallback(async () => {
    if (!mid) {
      return
    }

    store.dispatch(setFoldersLoading(true))
    const foldersResult = await withErrorHandling(
      () => apiFetchFolders(mid),
      (folders) => {
        store.dispatch(setFolders(folders))
        const currentExists = folders.some((f) => f.id === selectedFolderId)
        if (!currentExists) {
          if (folders.length > 0) {
            store.dispatch(setSelectedFolder(folders[0].id))
          } else {
            store.dispatch(reset())
          }
          return
        }
      },
    )
    if (!foldersResult) {
      store.dispatch(setFoldersLoading(false))
      return
    }

    const { folders: latestFolders, selectedFolderId: latestFolderId } =
      store.getState().favorite
    if (latestFolderId && latestFolders.some((f) => f.id === latestFolderId)) {
      store.dispatch(setLoading(true))
      await withErrorHandling(
        () => apiFetchVideos(latestFolderId, 1, PAGE_SIZE),
        (response) => {
          store.dispatch(setVideos(response))
        },
      )
    }
  }, [mid, selectedFolderId])

  return {
    folders,
    selectedFolderId,
    videos,
    hasMore,
    totalCount,
    currentPage,
    loading,
    foldersLoading,
    error,
    selectFolder,
    loadMore,
    refresh,
  }
}

/**
 * Formats duration in seconds to MM:SS or HH:MM:SS format.
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Formats play count to abbreviated string (e.g., "1.2M", "500K").
 */
export function formatPlayCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}
