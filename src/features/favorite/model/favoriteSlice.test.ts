/**
 * favoriteSlice unit suite.
 *
 * Dispatches against the real singleton store and asserts on
 * `store.getState().favorite`. reset restores the initial state in
 * beforeEach.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import type { FavoriteFolder, FavoriteVideo } from '../types'
import {
  appendVideos,
  reset,
  setCurrentPage,
  setError,
  setFolders,
  setFoldersLoading,
  setLoading,
  setSelectedFolder,
  setVideos,
} from './favoriteSlice'

const initialState = {
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

const folder = (id: number, title: string): FavoriteFolder => ({
  id,
  title,
  mediaCount: id,
})

const video = (id: number, bvid: string): FavoriteVideo => ({
  id,
  bvid,
  title: `Video ${id}`,
  cover: `https://example.com/${bvid}.jpg`,
  duration: 60,
  page: 1,
  upper: { mid: 1, name: 'upper', face: 'https://example.com/face.jpg' },
  attr: 0,
  playCount: 100,
  collectCount: 10,
  link: `https://www.bilibili.com/video/${bvid}`,
})

function favorite() {
  return store.getState().favorite
}

beforeEach(() => {
  store.dispatch(reset())
})

describe('folders', () => {
  it('setFolders stores the list and clears foldersLoading', () => {
    store.dispatch(setFoldersLoading(true))
    store.dispatch(setFolders([folder(1, 'Default'), folder(2, 'Later')]))

    expect(favorite()).toMatchObject({
      folders: [folder(1, 'Default'), folder(2, 'Later')],
      foldersLoading: false,
    })
  })
})

describe('setSelectedFolder', () => {
  it('resets pagination state and starts loading the new folder', () => {
    store.dispatch(
      setVideos({ videos: [video(1, 'BV1')], hasMore: true, totalCount: 30 }),
    )
    store.dispatch(setCurrentPage(3))

    store.dispatch(setSelectedFolder(2))

    expect(favorite()).toMatchObject({
      selectedFolderId: 2,
      videos: [],
      currentPage: 1,
      hasMore: false,
      loading: true,
    })
  })
})

describe('video pagination', () => {
  it('setVideos replaces the list and finishes loading', () => {
    store.dispatch(setLoading(true))
    store.dispatch(
      setVideos({ videos: [video(1, 'BV1')], hasMore: true, totalCount: 30 }),
    )

    expect(favorite()).toMatchObject({
      videos: [video(1, 'BV1')],
      hasMore: true,
      totalCount: 30,
      loading: false,
    })
  })

  it('appendVideos extends the list in order and advances the page', () => {
    store.dispatch(
      setVideos({ videos: [video(1, 'BV1')], hasMore: true, totalCount: 30 }),
    )
    store.dispatch(setLoading(true))

    store.dispatch(
      appendVideos({
        videos: [video(2, 'BV2'), video(3, 'BV3')],
        hasMore: false,
        totalCount: 30,
      }),
    )

    expect(favorite().videos.map((v) => v.id)).toEqual([1, 2, 3])
    expect(favorite()).toMatchObject({
      currentPage: 2,
      hasMore: false,
      loading: false,
    })
  })

  it('setCurrentPage and setLoading are independent toggles', () => {
    store.dispatch(setCurrentPage(5))
    store.dispatch(setLoading(true))
    expect(favorite()).toMatchObject({ currentPage: 5, loading: true })
  })
})

describe('setError', () => {
  it('records the error and clears both loading flags', () => {
    store.dispatch(setLoading(true))
    store.dispatch(setFoldersLoading(true))

    store.dispatch(setError('ERR::NETWORK'))

    expect(favorite()).toMatchObject({
      error: 'ERR::NETWORK',
      loading: false,
      foldersLoading: false,
    })
  })
})

describe('reset', () => {
  it('restores the initial state after browsing', () => {
    store.dispatch(setFolders([folder(1, 'Default')]))
    store.dispatch(setSelectedFolder(1))
    store.dispatch(
      setVideos({ videos: [video(1, 'BV1')], hasMore: true, totalCount: 1 }),
    )
    store.dispatch(reset())

    expect(favorite()).toEqual(initialState)
  })
})
