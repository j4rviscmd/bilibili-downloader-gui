/**
 * Pure-function tests for GIF/WebM timecode parsing and range validation.
 */

import { parseTimecode, validateGifRange } from '@/features/gif/lib/validation'
import { describe, expect, it } from 'vitest'

describe('parseTimecode (gif)', () => {
  it.each([
    ['00:00:10', 10],
    ['01:02:03', 3723],
    ['0:00:00.5', 0.5],
    ['12:34:56.789', 45296.789],
  ])('parses %p as %p seconds', (input, expected) => {
    expect(parseTimecode(input)).toBeCloseTo(expected, 5)
  })

  it.each(['', '  ', 'abc', '10', '00:70:00', '00:00:00,', '1:2:3'])(
    'rejects malformed input %p',
    (input) => {
      expect(parseTimecode(input)).toBeNull()
    },
  )

  it('trims surrounding whitespace', () => {
    expect(parseTimecode('  00:01:00  ')).toBe(60)
  })
})

describe('validateGifRange', () => {
  it('accepts a valid range', () => {
    expect(validateGifRange('00:00:01', '00:00:10')).toBeNull()
  })

  it('flags an empty start separately from a malformed one', () => {
    expect(validateGifRange('', '00:00:10')).toBe('empty_start')
    expect(validateGifRange('bogus', '00:00:10')).toBe('invalid_start')
  })

  it('flags an empty end separately from a malformed one', () => {
    expect(validateGifRange('00:00:01', '')).toBe('empty_end')
    expect(validateGifRange('00:00:01', 'x')).toBe('invalid_end')
  })

  it('rejects end <= start', () => {
    expect(validateGifRange('00:00:10', '00:00:05')).toBe('end_before_start')
    expect(validateGifRange('00:00:10', '00:00:10')).toBe('end_before_start')
  })
})
