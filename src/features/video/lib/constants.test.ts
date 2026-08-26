import { describe, expect, it } from 'vitest'
import { VIDEO_QUALITIES_MAP, VIDEO_QUALITIES_ORDER } from './constants'

describe('VIDEO_QUALITIES_MAP', () => {
  it('uses official playurl qn labels for 4K and HDR', () => {
    expect(VIDEO_QUALITIES_MAP[120]).toBe('4K')
    expect(VIDEO_QUALITIES_MAP[125]).toBe('HDR10')
    expect(VIDEO_QUALITIES_MAP[126]).toBe('Dolby Vision')
    expect(VIDEO_QUALITIES_MAP[127]).toBe('8K')
    expect(VIDEO_QUALITIES_MAP[116]).toBe('1080p60')
  })

  it('lists qualities from highest to lowest', () => {
    expect(VIDEO_QUALITIES_ORDER[0]).toBe(127)
    expect(VIDEO_QUALITIES_ORDER.at(-1)).toBe(16)
    for (const id of VIDEO_QUALITIES_ORDER) {
      expect(VIDEO_QUALITIES_MAP[id]).toBeDefined()
    }
  })
})
