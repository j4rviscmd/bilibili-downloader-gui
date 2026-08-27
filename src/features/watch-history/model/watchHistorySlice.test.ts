/**
 * watchHistorySlice unit suite.
 *
 * Dispatches against the real singleton store and asserts on
 * `store.getState().watchHistory`. reset restores the initial state in
 * beforeEach.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import type { WatchHistoryEntry } from '../types'
import {
  appendEntries,
  reset,
  setCursor,
  setDateFilter,
  setEntries,
  setError,
  setLoading,
  setLoadingMore,
  setSearchQuery,
} from './watchHistorySlice'

const initialState = {
  entries: [],
  cursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  searchQuery: '',
  dateFilter: 'all',
}

const entry = (bvid: string): WatchHistoryEntry => ({
  title: `Video ${bvid}`,
  cover: `https://example.com/${bvid}.jpg`,
  bvid,
  cid: 1,
  page: 1,
  viewAt: 1_700_000_000,
  duration: 100,
  progress: 50,
  url: `https://www.bilibili.com/video/${bvid}`,
})

function history() {
  return store.getState().watchHistory
}

beforeEach(() => {
  store.dispatch(reset())
})

describe('entries', () => {
  it('setEntries replaces the list', () => {
    store.dispatch(setEntries([entry('BV1'), entry('BV2')]))
    store.dispatch(setEntries([entry('BV3')]))
    expect(history().entries).toEqual([entry('BV3')])
  })

  it('appendEntries extends the list preserving order', () => {
    store.dispatch(setEntries([entry('BV1')]))
    store.dispatch(appendEntries([entry('BV2'), entry('BV3')]))
    expect(history().entries.map((e) => e.bvid)).toEqual(['BV1', 'BV2', 'BV3'])
  })

  it('setCursor stores the pagination cursor or null', () => {
    const cursor = { viewAt: 1_699_000_000, max: 1_700_000_000, isEnd: false }
    store.dispatch(setCursor(cursor))
    expect(history().cursor).toEqual(cursor)

    store.dispatch(setCursor(null))
    expect(history().cursor).toBeNull()
  })
})

describe('loading and error flags', () => {
  it('loading and loadingMore are independent flags', () => {
    store.dispatch(setLoading(true))
    store.dispatch(setLoadingMore(true))
    expect(history()).toMatchObject({ loading: true, loadingMore: true })

    store.dispatch(setLoading(false))
    expect(history().loading).toBe(false)
    expect(history().loadingMore).toBe(true)
  })

  it('setError stores and clears the error message', () => {
    store.dispatch(setError('ERR::HISTORY_FETCH_FAILED'))
    expect(history().error).toBe('ERR::HISTORY_FETCH_FAILED')

    store.dispatch(setError(null))
    expect(history().error).toBeNull()
  })
})

describe('filters', () => {
  it('setSearchQuery updates the query', () => {
    store.dispatch(setSearchQuery('rust tutorial'))
    expect(history().searchQuery).toBe('rust tutorial')
  })

  const dateFilters: ['all' | 'today' | 'week' | 'month'][] = [
    ['all'],
    ['today'],
    ['week'],
    ['month'],
  ]

  it.each(dateFilters)('setDateFilter accepts %s', (filter) => {
    store.dispatch(setDateFilter(filter))
    expect(history().dateFilter).toBe(filter)
  })
})

describe('reset', () => {
  it('restores the initial state after browsing', () => {
    store.dispatch(setEntries([entry('BV1')]))
    store.dispatch(setCursor({ viewAt: 1, max: 2, isEnd: true }))
    store.dispatch(setLoading(true))
    store.dispatch(setError('boom'))
    store.dispatch(setSearchQuery('q'))
    store.dispatch(setDateFilter('week'))

    store.dispatch(reset())

    expect(history()).toEqual(initialState)
  })
})
