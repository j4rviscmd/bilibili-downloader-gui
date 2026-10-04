import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import {
  initialState,
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
