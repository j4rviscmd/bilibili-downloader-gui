/**
 * watch-history selectors — date filter gaps.
 *
 * The sibling selectors.test.ts covers live-stream exclusion and search
 * matching. This file covers the date range filter (today/week/month),
 * which is clock-dependent, against the real singleton store with a
 * frozen system time.
 */

import { store } from '@/app/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectFilteredEntries } from './selectors'
import {
  reset,
  setDateFilter,
  setEntries,
  setSearchQuery,
} from './watchHistorySlice'

/** Fixed "now" so cutoff math is deterministic: 2026-08-27T12:00:00Z */
const NOW_MS = Date.UTC(2026, 7, 27, 12, 0, 0)
const nowSec = NOW_MS / 1000

/** viewAt offset in seconds relative to NOW (negative = past). */
const entry = (title: string, offsetSec: number) => ({
  title,
  cover: 'https://example.com/c.jpg',
  bvid: `BV-${title}`,
  cid: 1,
  page: 1,
  viewAt: nowSec + offsetSec,
  duration: 100,
  progress: 10,
  url: 'https://www.bilibili.com/video/BV1',
})

const HOUR = 3600
const DAY = 24 * HOUR

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  store.dispatch(reset())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('selectFilteredEntries date filter', () => {
  it('all keeps every non-live entry regardless of age', () => {
    store.dispatch(
      setEntries([entry('Recent', -HOUR), entry('Ancient', -400 * DAY)]),
    )

    expect(selectFilteredEntries(store.getState())).toHaveLength(2)
  })

  // [filter, includedOffsetSec, excludedOffsetSec]
  const dateRows: ['today' | 'week' | 'month', number, number][] = [
    ['today', -HOUR, -25 * HOUR],
    ['week', -3 * DAY, -8 * DAY],
    ['month', -20 * DAY, -40 * DAY],
  ]

  it.each(dateRows)(
    '%s includes %is-ago and excludes %is-ago',
    (filter, included, excluded) => {
      store.dispatch(
        setEntries([entry('Inside', included), entry('Outside', excluded)]),
      )
      store.dispatch(setDateFilter(filter))

      const result = selectFilteredEntries(store.getState())

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Inside')
    },
  )

  it('today cutoff lands at local midnight, not a rolling 24h window', () => {
    // Viewed yesterday 23:00 (13h before the frozen noon "now"): older than
    // 0h but still before today 00:00, so 'today' must exclude it while
    // 'all' keeps it.
    const yesterdayLate = new Date(NOW_MS)
    yesterdayLate.setHours(23, 0, 0, 0)
    yesterdayLate.setDate(yesterdayLate.getDate() - 1)
    const viewAt = Math.floor(yesterdayLate.getTime() / 1000)

    store.dispatch(setEntries([{ ...entry('LateNight', 0), viewAt }]))

    store.dispatch(setDateFilter('today'))
    expect(selectFilteredEntries(store.getState())).toHaveLength(0)

    store.dispatch(setDateFilter('all'))
    expect(selectFilteredEntries(store.getState())).toHaveLength(1)
  })

  it('combines date filter with search and live exclusion', () => {
    store.dispatch(
      setEntries([
        entry('Rust Today', -HOUR),
        entry('Rust Long Ago', -30 * DAY),
        { ...entry('Live Now', -HOUR), bvid: '' },
      ]),
    )
    store.dispatch(setDateFilter('week'))
    store.dispatch(setSearchQuery('rust'))

    const result = selectFilteredEntries(store.getState())

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Rust Today')
  })
})
