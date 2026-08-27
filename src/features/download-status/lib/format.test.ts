import { describe, expect, it } from 'vitest'
import { finiteNumber, formatPercent, formatTransferRate } from './format'

describe('finiteNumber', () => {
  it('passes through finite numbers', () => {
    expect(finiteNumber(12.5)).toBe(12.5)
    expect(finiteNumber(0)).toBe(0)
  })

  it('falls back for missing or non-finite values', () => {
    expect(finiteNumber(undefined)).toBe(0)
    expect(finiteNumber(null)).toBe(0)
    expect(finiteNumber(Number.NaN)).toBe(0)
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBe(0)
    expect(finiteNumber('12')).toBe(0)
  })
})

describe('formatTransferRate', () => {
  it('does not throw on missing values (stream-error progress payloads)', () => {
    expect(formatTransferRate(undefined)).toBe('0KB/s')
    expect(formatTransferRate(null)).toBe('0KB/s')
    expect(formatTransferRate(Number.NaN)).toBe('0KB/s')
  })

  it('formats KB and MB rates', () => {
    expect(formatTransferRate(400)).toBe('400KB/s')
    expect(formatTransferRate(2048)).toBe('2.0MB/s')
  })
})

describe('formatPercent', () => {
  it('does not throw on missing values', () => {
    expect(formatPercent(undefined)).toBe('0')
    expect(formatPercent(Number.NaN)).toBe('0')
  })

  it('clamps to 0–100', () => {
    expect(formatPercent(-5)).toBe('0')
    expect(formatPercent(47.6)).toBe('48')
    expect(formatPercent(150)).toBe('100')
  })
})
