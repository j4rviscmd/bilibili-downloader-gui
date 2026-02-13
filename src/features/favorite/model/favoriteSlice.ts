/**
 * Favorite Redux slice.
 *
 * Manages state for Bilibili favorite folders and videos.
 */

import type { FavoriteFolder, FavoriteVideo } from '../types'
import { createSlice } from '@reduxjs/toolkit'

export type FavoriteState = {
  folders: FavoriteFolder[]
  selectedFolderId: number | null
  videos: FavoriteVideo[]
  hasMore: boolean
  totalCount: number
  currentPage: number
  loading: boolean
  foldersLoading: boolean
  error: string | null
}

const initialState: FavoriteState = {
  folders: [],
  selectedFolderId: null,
  videos: [],
  hasMore: false,
  totalCount: 0,
  currentPage: 1,
  loading: false,
  foldersLoading: false,
  error: null,
}

export const favoriteSlice = createSlice({
  name: 'favorite',
  initialState,
  reducers: {
    setFolders: (state, action) => {
      state.folders = action.payload
      state.foldersLoading = false
    },
    setFoldersLoading: (state, action) => {
      state.foldersLoading = action.payload
    },
    setSelectedFolder: (state, action) => {
      state.selectedFolderId = action.payload
      state.videos = []
      state.currentPage = 1
      state.hasMore = false
      state.loading = true
    },
    setVideos: (state, action) => {
      state.videos = action.payload.videos
      state.hasMore = action.payload.hasMore
      state.totalCount = action.payload.totalCount
      state.loading = false
    },
    appendVideos: (state, action) => {
      state.videos = [...state.videos, ...action.payload.videos]
      state.hasMore = action.payload.hasMore
      state.currentPage += 1
      state.loading = false
    },
    setCurrentPage: (state, action) => {
      state.currentPage = action.payload
    },
    setLoading: (state, action) => {
      state.loading = action.payload
    },
    setError: (state, action) => {
      state.error = action.payload
      state.loading = false
      state.foldersLoading = false
    },
    reset: () => initialState,
  },
})

export const {
  setFolders,
  setFoldersLoading,
  setSelectedFolder,
  setVideos,
  appendVideos,
  setCurrentPage,
  setLoading,
  setError,
  reset,
} = favoriteSlice.actions

export default favoriteSlice.reducer
