import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import {
  cacheStore,
  clearFeeds,
  clearSearchCache,
  initialState,
  resetEntries,
  restoreFeed,
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

/** Card variant with a distinct bvid (accumulation and stack fixtures). */
const entry = (bvid: string) => ({ ...response.entries[0], bvid })

describe('videoSearchSlice', () => {
  it('returns the initial state', () => {
    expect(videoSearchSlice.getInitialState()).toEqual(initialState)
  })

  it('setResult stores keyword, page, response and cards, clears error', () => {
    const state = videoSearchSlice.reducer(
      { ...initialState, error: 'ERR::RATE_LIMITED' },
      setResult({ keyword: 'kw', page: 1, response }),
    )
    expect(state.keyword).toBe('kw')
    expect(state.page).toBe(1)
    expect(state.results).toBe(response)
    // A page-1 fetch replaces the accumulated cards.
    expect(state.entries).toBe(response.entries)
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

describe('videoSearchSlice infinite-scroll accumulation', () => {
  const page = (n: number, bvids: string[]) => ({
    ...response,
    page: n,
    entries: bvids.map(entry),
  })

  it('appends a continuous next page, deduping repeated bvids', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1', 'BV2']) }),
    )
    // BV2 repeated: result pages can shift between requests.
    state = videoSearchSlice.reducer(
      state,
      setResult({ keyword: 'kw', page: 2, response: page(2, ['BV2', 'BV3']) }),
    )
    expect(state.entries.map((e) => e.bvid)).toEqual(['BV1', 'BV2', 'BV3'])
  })

  it('replaces the feed on a page-1 fetch (filter change, cache restore)', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
    )
    state = videoSearchSlice.reducer(
      state,
      setResult({ keyword: 'kw', page: 2, response: page(2, ['BV2']) }),
    )
    state = videoSearchSlice.reducer(
      state,
      setResult({ keyword: 'kw', page: 1, response: page(1, ['BV9']) }),
    )
    expect(state.entries.map((e) => e.bvid)).toEqual(['BV9'])
    expect(state.page).toBe(1)
  })

  it('replaces (not appends) on a new keyword or a page gap', () => {
    const twoPages = videoSearchSlice.reducer(
      videoSearchSlice.reducer(
        initialState,
        setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
      ),
      setResult({ keyword: 'kw', page: 2, response: page(2, ['BV2']) }),
    )

    const newKeyword = videoSearchSlice.reducer(
      twoPages,
      setResult({ keyword: 'other', page: 3, response: page(3, ['BV3']) }),
    )
    expect(newKeyword.entries.map((e) => e.bvid)).toEqual(['BV3'])

    const gap = videoSearchSlice.reducer(
      twoPages,
      setResult({ keyword: 'kw', page: 4, response: page(4, ['BV4']) }),
    )
    expect(gap.entries.map((e) => e.bvid)).toEqual(['BV4'])
  })

  it('resetEntries clears only the accumulated cards', () => {
    const state = videoSearchSlice.reducer(
      videoSearchSlice.reducer(
        initialState,
        setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
      ),
      resetEntries(),
    )
    expect(state.entries).toEqual([])
    // The last response stays: loading flags and the pending fetch own
    // the rest of the state.
    expect(state.results).not.toBeNull()
    expect(state.page).toBe(1)
  })
})

describe('videoSearchSlice keyword feed stack', () => {
  const page = (n: number, bvids: string[]) => ({
    ...response,
    page: n,
    numPages: 3,
    entries: bvids.map(entry),
  })

  it('setResult mirrors the accumulation into the keyword feed', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
    )
    state = videoSearchSlice.reducer(
      state,
      setResult({ keyword: 'kw', page: 2, response: page(2, ['BV2']) }),
    )
    expect(state.feeds.kw).toEqual({
      filters: DEFAULT_VIDEO_SEARCH_FILTERS,
      entries: [entry('BV1'), entry('BV2')],
      page: 2,
      numPages: 3,
      numResults: response.numResults,
    })
  })

  it('restoreFeed restores entries, filters and page depth', () => {
    // Load 'kw' two pages deep, then switch to another keyword's page 1.
    let state = videoSearchSlice.reducer(
      videoSearchSlice.reducer(
        initialState,
        setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
      ),
      setResult({ keyword: 'kw', page: 2, response: page(2, ['BV2']) }),
    )
    state = videoSearchSlice.reducer(
      state,
      setResult({ keyword: 'other', page: 1, response: page(1, ['BX']) }),
    )

    // Back to 'kw': the stack hands back both loaded pages.
    state = videoSearchSlice.reducer(
      state,
      restoreFeed({ keyword: 'kw', feed: state.feeds.kw! }),
    )
    expect(state.keyword).toBe('kw')
    expect(state.page).toBe(2)
    expect(state.entries.map((e) => e.bvid)).toEqual(['BV1', 'BV2'])
    expect(state.results?.numPages).toBe(3)
    expect(state.loading).toBe(false)
  })

  it('keeps at most 10 stacked feeds, evicting the oldest — numeric keywords included', () => {
    let state = initialState
    for (let i = 0; i < 12; i++) {
      // Integer-like keywords ('0'..'11') sort numerically first in JS
      // objects — the explicit feedOrder array must override that.
      state = videoSearchSlice.reducer(
        state,
        setResult({
          keyword: String(i),
          page: 1,
          response: page(1, [`BV${i}`]),
        }),
      )
    }
    expect(state.feedOrder).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
    ])
    expect(state.feeds['11']).toBeDefined()
    // '0' and '1' are the oldest — evicted despite sorting first.
    expect(state.feeds['0']).toBeUndefined()
    expect(state.feeds['1']).toBeUndefined()
  })

  it('clearFeeds empties the stack', () => {
    let state = videoSearchSlice.reducer(
      initialState,
      setResult({ keyword: 'kw', page: 1, response: page(1, ['BV1']) }),
    )
    state = videoSearchSlice.reducer(state, clearFeeds())
    expect(state.feeds).toEqual({})
    expect(state.feedOrder).toEqual([])
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
