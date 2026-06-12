import { describe, expect, it } from 'vitest'

import { parseTimecode, validateTrimRange } from './validation'

describe('parseTimecode', () => {
  it('parses hh:mm:ss into seconds', () => {
    expect(parseTimecode('01:23:45')).toBe(5025)
    expect(parseTimecode('00:00:10')).toBe(10)
    expect(parseTimecode('1:02:03')).toBe(3723)
    expect(parseTimecode('99:00:00')).toBe(356400)
  })

  it('preserves fractional seconds', () => {
    expect(parseTimecode('00:00:10.5')).toBe(10.5)
    expect(parseTimecode('00:00:10.250')).toBe(10.25)
  })

  it('trims surrounding whitespace', () => {
    expect(parseTimecode('  00:01:30  ')).toBe(90)
  })

  it('returns null for empty string', () => {
    expect(parseTimecode('')).toBeNull()
    expect(parseTimecode('   ')).toBeNull()
  })

  it('returns null for invalid formats', () => {
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('1:2:3')).toBeNull()
    expect(parseTimecode('00:60:00')).toBeNull()
    expect(parseTimecode('00:00:60')).toBeNull()
    expect(parseTimecode('00:00')).toBeNull()
    expect(parseTimecode('12345')).toBeNull()
  })
})

describe('validateTrimRange', () => {
  it('returns null for a valid range', () => {
    expect(validateTrimRange('00:01:00', '00:05:00')).toBeNull()
  })

  it('allows only start to be set', () => {
    expect(validateTrimRange('00:01:00', '')).toBeNull()
  })

  it('allows only end to be set', () => {
    expect(validateTrimRange('', '00:05:00')).toBeNull()
  })

  it('rejects when both are empty', () => {
    expect(validateTrimRange('', '')).toBe('both_empty')
  })

  it('rejects when start is malformed', () => {
    expect(validateTrimRange('abc', '00:05:00')).toBe('invalid_start')
  })

  it('rejects when end is malformed', () => {
    expect(validateTrimRange('00:01:00', 'xyz')).toBe('invalid_end')
  })

  it('rejects when end equals start', () => {
    expect(validateTrimRange('00:05:00', '00:05:00')).toBe('end_before_start')
  })

  it('rejects when end is before start', () => {
    expect(validateTrimRange('00:10:00', '00:05:00')).toBe('end_before_start')
  })
})
