import { describe, expect, it } from 'vitest'
import { SEARCH_ZONES, zoneKeyForTid } from './zones'

describe('zoneKeyForTid', () => {
  it('maps main zones directly', () => {
    expect(zoneKeyForTid('3')).toBe('music')
    expect(zoneKeyForTid('11')).toBe('tv')
  })

  it('maps sub zones to their parent', () => {
    // 193 = MV (音乐), 136 = 音游 (游戏), 37 = 人文·历史 (纪录片)
    expect(zoneKeyForTid('193')).toBe('music')
    expect(zoneKeyForTid('136')).toBe('game')
    expect(zoneKeyForTid('37')).toBe('documentary')
  })

  it('returns null for unknown or malformed tids', () => {
    expect(zoneKeyForTid('9999')).toBeNull()
    expect(zoneKeyForTid('')).toBeNull()
    expect(zoneKeyForTid('abc')).toBeNull()
    expect(zoneKeyForTid('-1')).toBeNull()
  })

  it('keeps every SEARCH_ZONES tid self-resolvable', () => {
    for (const z of SEARCH_ZONES) {
      expect(zoneKeyForTid(String(z.tid))).toBe(z.key)
    }
  })
})
