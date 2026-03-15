import { describe, expect, it } from 'vitest'
import type { WatchHistoryEntry, WatchHistoryState } from '../types'
import { selectFilteredEntries } from './selectors'

/** Minimal RootState shape needed to test watch history selectors. */
type MinimalState = { watchHistory: WatchHistoryState }

/**
 * Creates a minimal Redux state object for watch history selector tests.
 *
 * @param entries - Watch history entries to include in state
 * @param overrides - Optional partial state overrides
 * @returns Minimal state object
 */
const makeState = (
  entries: WatchHistoryEntry[],
  overrides: Partial<WatchHistoryState> = {},
): MinimalState => ({
  watchHistory: {
    entries,
    cursor: null,
    loading: false,
    loadingMore: false,
    error: null,
    searchQuery: '',
    dateFilter: 'all',
    ...overrides,
  },
})

/**
 * Creates a watch history entry with sensible defaults for testing.
 *
 * @param overrides - Optional partial entry overrides
 * @returns A complete WatchHistoryEntry object
 */
const makeEntry = (
  overrides: Partial<WatchHistoryEntry> = {},
): WatchHistoryEntry => ({
  title: 'Test Video',
  cover: 'https://example.com/cover.jpg',
  bvid: 'BV1xx411c7XD',
  cid: 123,
  page: 1,
  viewAt: Math.floor(Date.now() / 1000),
  duration: 300,
  progress: 60,
  url: 'https://www.bilibili.com/video/BV1xx411c7XD',
  ...overrides,
})

describe('selectFilteredEntries', () => {
  describe('live stream filtering', () => {
    it('excludes entries with empty bvid (live streams)', () => {
      const liveEntry = makeEntry({
        bvid: '',
        url: 'https://www.bilibili.com/video/',
      })
      const state = makeState([liveEntry])

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(0)
    })

    it('includes entries with a non-empty bvid (VOD)', () => {
      const videoEntry = makeEntry({
        bvid: 'BV1xx411c7XD',
        url: 'https://www.bilibili.com/video/BV1xx411c7XD',
      })
      const state = makeState([videoEntry])

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(1)
      expect(result[0].bvid).toBe('BV1xx411c7XD')
    })

    it('filters out only live entries when mixed with video entries', () => {
      const liveEntry = makeEntry({
        title: 'Live Stream',
        bvid: '',
        url: 'https://www.bilibili.com/video/',
      })
      const videoEntry = makeEntry({
        title: 'Normal Video',
        bvid: 'BV1xx411c7XD',
        url: 'https://www.bilibili.com/video/BV1xx411c7XD',
      })
      const state = makeState([liveEntry, videoEntry])

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Normal Video')
    })

    it('does not exclude entries with any non-empty bvid value', () => {
      const entry = makeEntry({ bvid: 'BV_any_value' })
      const state = makeState([entry])

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(1)
    })
  })

  describe('search query filtering', () => {
    it('filters entries by title (case-insensitive)', () => {
      const entries = [
        makeEntry({ title: 'Rust Tutorial' }),
        makeEntry({ title: 'TypeScript Guide' }),
      ]
      const state = makeState(entries, { searchQuery: 'rust' })

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Rust Tutorial')
    })

    it('returns all non-live entries when search query is empty', () => {
      const entries = [
        makeEntry({ title: 'Video A' }),
        makeEntry({ title: 'Video B' }),
      ]
      const state = makeState(entries, { searchQuery: '' })

      const result = selectFilteredEntries(state as never)

      expect(result).toHaveLength(2)
    })
  })
})
