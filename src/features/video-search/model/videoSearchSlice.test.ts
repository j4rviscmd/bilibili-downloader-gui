import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import {
  cacheStore,
  clearSearchCache,
  initialState,
  searchCacheKey,
  setError,
  setFilter,
  setLoading,
  setResult,
  videoSearchSlice,
} from './videoSearchSlice'

const response = {
  page: 1,
  numResults: 1000,
  numPages: 50,
  entries: [
    {
      bvid: 'BV1De411p77r',
      title: 't',
      cover: 'https://x/1.jpg',
      author: 'a',
      play: 5,
      duration: 61,
      typeid: '193',
      typename: 'MV',
    },
  ],
}

describe('videoSearchSlice', () => {
  it('returns the initial state', () => {
    expect(videoSearchSlice.getInitialState()).toEqual(initialState)
  })

  it('setResult stores keyword, page and response, clears error', () => {
    const state = videoSearchSlice.reducer(
      { ...initialState, error: 'ERR::RATE_LIMITED' },
      setResult({ keyword: 'kw', page: 1, response }),
    )
    expect(state.keyword).toBe('kw')
    expect(state.page).toBe(1)
    expect(state.results).toBe(response)
    expect(state.error).toBeNull()
  })

  it('setLoading and setError update their flags', () => {
    let state = videoSearchSlice.reducer(initialState, setLoading(true))
    expect(state.loading).toBe(true)
    state = videoSearchSlice.reducer(state, setError('ERR::RATE_LIMITED'))
    expect(state.error).toBe('ERR::RATE_LIMITED')
    state = videoSearchSlice.reducer(state, setLoading(false))
    expect(state.loading).toBe(false)
    expect(state.error).toBe('ERR::RATE_LIMITED')
  })

  it('setFilter patches only the given fields', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      setFilter({ order: 'pubdate' }),
    )
    expect(state.filters).toEqual({
      ...DEFAULT_VIDEO_SEARCH_FILTERS,
      order: 'pubdate',
    })

    state = videoSearchSlice.reducer(state, setFilter({ tids: 4 }))
    expect(state.filters).toEqual({
      ...DEFAULT_VIDEO_SEARCH_FILTERS,
      order: 'pubdate',
      tids: 4,
    })
  })
})

describe('videoSearchSlice response cache', () => {
  it('builds a cache key from keyword, page and all filters', () => {
    expect(
      searchCacheKey('kw', 2, { order: 'click', duration: 1, tids: 4 }),
    ).toBe('kw|2|click|1|4')
  })

  it('cacheStore keeps at most 10 entries, evicting the oldest', () => {
    let state = initialState
    for (let i = 0; i < 12; i++) {
      state = videoSearchSlice.reducer(
        state,
        cacheStore({
          key: `kw${i}|1|totalrank|0|0`,
          response: { ...response, numResults: i },
        }),
      )
    }
    const keys = Object.keys(state.cache)
    expect(keys).toHaveLength(10)
    // Oldest two evicted, newest kept.
    expect(keys).not.toContain('kw0|1|totalrank|0|0')
    expect(keys).not.toContain('kw1|1|totalrank|0|0')
    expect(keys).toContain('kw11|1|totalrank|0|0')
  })

  it('clearSearchCache empties the cache', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      cacheStore({ key: 'kw|1|totalrank|0|0', response }),
    )
    state = videoSearchSlice.reducer(state, clearSearchCache())
    expect(state.cache).toEqual({})
  })
})
