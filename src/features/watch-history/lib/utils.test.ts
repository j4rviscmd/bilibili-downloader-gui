/**
 * watch-history lib utils suite.
 *
 * Pure formatting functions. The setup i18next mock makes `i18n.t` an
 * identity `t`, so i18n-backed formatters return their raw key —
 * interpolation is only observable where the key itself carries
 * {{placeholders}} (none do today).
 *
 * formatRelativeTime reads Date.now(), so timestamps are computed from a
 * frozen "now" instead of hard-coded epoch values.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  calculateProgress,
  formatDuration,
  formatDurationShort,
  formatRelativeTime,
} from './utils'

const NOW = new Date('2026-08-30T12:00:00Z').getTime()

/** Seconds ago relative to the frozen NOW. */
const secondsAgo = (s: number) => Math.floor(NOW / 1000) - s

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to justNow under one minute', () => {
    expect(formatRelativeTime(secondsAgo(30))).toBe('watchHistory.time.justNow')
  })

  it('uses the minutes bucket for less than an hour', () => {
    expect(formatRelativeTime(secondsAgo(90))).toBe(
      'watchHistory.time.minutesAgo',
    )
  })

  it('uses the hours bucket for less than a day', () => {
    expect(formatRelativeTime(secondsAgo(2 * 3600))).toBe(
      'watchHistory.time.hoursAgo',
    )
  })

  it('uses the days bucket beyond 24h', () => {
    expect(formatRelativeTime(secondsAgo(3 * 86400))).toBe(
      'watchHistory.time.daysAgo',
    )
  })
})

describe('formatDuration', () => {
  it('formats without the hours part under one hour', () => {
    expect(formatDuration(330)).toBe('watchHistory.time.durationMS')
  })

  it('keeps the hours part at one hour and above', () => {
    expect(formatDuration(6711)).toBe('watchHistory.time.durationHMS')
  })
})

describe('formatDurationShort', () => {
  it('formats m:ss under one hour with zero-padded seconds', () => {
    expect(formatDurationShort(205)).toBe('3:25')
  })

  it('formats h:mm:ss at one hour and above', () => {
    expect(formatDurationShort(6713)).toBe('1:51:53')
  })
})

describe('calculateProgress', () => {
  it('returns 0 for a non-positive duration', () => {
    expect(calculateProgress(50, 0)).toBe(0)
    expect(calculateProgress(50, -10)).toBe(0)
  })

  it('clamps the ratio into 0-100', () => {
    expect(calculateProgress(50, 100)).toBe(50)
    expect(calculateProgress(150, 100)).toBe(100)
    expect(calculateProgress(-10, 100)).toBe(0)
  })
})
