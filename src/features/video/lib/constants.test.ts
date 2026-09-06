import { describe, expect, it } from 'vitest'

import { VIDEO_QUALITIES_MAP, VIDEO_QUALITIES_ORDER } from './constants'

describe('VIDEO_QUALITIES_MAP', () => {
  it('uses official playurl qn labels for 4K and above', () => {
    expect(VIDEO_QUALITIES_MAP[120]).toBe('4K')
    expect(VIDEO_QUALITIES_MAP[125]).toBe('HDR10')
    expect(VIDEO_QUALITIES_MAP[126]).toBe('Dolby Vision')
    expect(VIDEO_QUALITIES_MAP[127]).toBe('8K')
    expect(VIDEO_QUALITIES_MAP[116]).toBe('1080p60')
  })
})

describe('VIDEO_QUALITIES_ORDER', () => {
  it('lists qualities from highest to lowest', () => {
    expect(VIDEO_QUALITIES_ORDER[0]).toBe(127)
    expect(VIDEO_QUALITIES_ORDER.at(-1)).toBe(16)
    // Strictly descending
    const sorted = [...VIDEO_QUALITIES_ORDER].sort((a, b) => b - a)
    expect(VIDEO_QUALITIES_ORDER).toEqual(sorted)
  })

  it('covers every entry in VIDEO_QUALITIES_MAP', () => {
    expect(VIDEO_QUALITIES_ORDER).toHaveLength(
      Object.keys(VIDEO_QUALITIES_MAP).length,
    )
    for (const id of VIDEO_QUALITIES_ORDER) {
      expect(VIDEO_QUALITIES_MAP[id]).toBeDefined()
    }
  })
})
