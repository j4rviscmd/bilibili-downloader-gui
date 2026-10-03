import { describe, expect, it } from 'vitest'
import { formatDuration } from './formatDuration'

describe('formatDuration', () => {
  it('formats minutes:seconds', () => {
    expect(formatDuration(287)).toBe('4:47')
  })
  it('pads seconds', () => {
    expect(formatDuration(61)).toBe('1:01')
  })
  it('handles under a minute and zero', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(0)).toBe('0:00')
  })
  it('switches to h:mm:ss past an hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3661)).toBe('1:01:01')
  })
  it('clamps negative input', () => {
    expect(formatDuration(-3)).toBe('0:00')
  })
})
