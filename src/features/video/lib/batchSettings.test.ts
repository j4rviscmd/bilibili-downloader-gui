import { describe, expect, it } from 'vitest'
import {
  LOGIN_REQUIRED_VIDEO_IDS,
  VIDEO_LADDER_IDS,
  matchesSelectedLan,
  predictAdjustment,
  resolveTarget,
  selectedLanPriority,
  unionIds,
} from './batchSettings'

describe('unionIds', () => {
  it('unions per-part availability in ladder order', () => {
    const union = unionIds(VIDEO_LADDER_IDS, [
      [80, 64, 32],
      [116, 112, 80, 74, 64, 32, 16],
      [74, 64, 32, 16], // P3: 1080p unavailable
    ])
    expect(union).toEqual([116, 112, 80, 74, 64, 32, 16])
  })

  it('drops ids outside the ladder (unknown extras never surface)', () => {
    expect(unionIds(VIDEO_LADDER_IDS, [[80, 999]])).toEqual([80])
  })

  it('returns an empty union when nothing is selected', () => {
    expect(unionIds(VIDEO_LADDER_IDS, [])).toEqual([])
  })
})

describe('resolveTarget', () => {
  it('keeps the target when available', () => {
    expect(resolveTarget(80, [116, 80, 64], VIDEO_LADDER_IDS)).toBe(80)
  })

  it('steps down to the nearest available quality below the target', () => {
    // 1080p target, part only offers up to 720p60
    expect(resolveTarget(80, [74, 64, 32], VIDEO_LADDER_IDS)).toBe(74)
  })

  it('falls back to the lowest available when nothing meets the target', () => {
    expect(resolveTarget(16, [80, 64, 32], VIDEO_LADDER_IDS)).toBe(32)
  })
})

describe('predictAdjustment', () => {
  it('is false when the target resolves to itself', () => {
    expect(predictAdjustment(80, [80, 64], VIDEO_LADDER_IDS)).toBe(false)
  })

  it('is true when the part would be auto-adjusted below the target', () => {
    expect(predictAdjustment(80, [74, 64], VIDEO_LADDER_IDS)).toBe(true)
  })
})

describe('LOGIN_REQUIRED_VIDEO_IDS', () => {
  it('marks exactly the 1080p+ / 1080p60 band', () => {
    expect([...LOGIN_REQUIRED_VIDEO_IDS].sort()).toEqual([112, 116])
  })
})

describe('subtitle language matching', () => {
  it('matches exact and ai-prefixed codes against the base selection', () => {
    expect(matchesSelectedLan(['ja', 'en'], 'ja')).toBe(true)
    expect(matchesSelectedLan(['ja', 'en'], 'ai-ja')).toBe(true)
    expect(matchesSelectedLan(['ja'], 'ko')).toBe(false)
  })

  it('aliases ai-zh (auto-generated simplified Chinese) to zh-Hans', () => {
    // bilibili returns "ai-zh" for AI Chinese; the fixed list only offers
    // zh-Hans/zh-Hant, so the stripped base "zh" matched nothing and
    // batch soft-sub downloads embedded no subtitles.
    expect(matchesSelectedLan(['zh-Hans'], 'ai-zh')).toBe(true)
    expect(selectedLanPriority(['ko', 'zh-Hans'], 'ai-zh')).toBe(1)
    // AI Chinese is SIMPLIFIED: a zh-Hant-only selection must not match.
    expect(matchesSelectedLan(['zh-Hant'], 'ai-zh')).toBe(false)
  })

  it('aliases the legacy zh-CN code to zh-Hans', () => {
    // Older uploads still report "zh-CN" for simplified Chinese.
    expect(matchesSelectedLan(['zh-Hans'], 'zh-CN')).toBe(true)
    expect(matchesSelectedLan(['zh-Hant'], 'zh-CN')).toBe(false)
    expect(selectedLanPriority(['ja', 'zh-Hans'], 'zh-CN')).toBe(1)
  })

  it('drops region suffixes and maps traditional Chinese variants', () => {
    // Documented real-world form: en-US must match a plain "en" pick.
    expect(matchesSelectedLan(['en'], 'en-US')).toBe(true)
    expect(selectedLanPriority(['ja', 'en'], 'en-US')).toBe(1)
    // Traditional variants collapse to zh-Hant — never to zh-Hans.
    expect(matchesSelectedLan(['zh-Hant'], 'zh-TW')).toBe(true)
    expect(matchesSelectedLan(['zh-Hans'], 'zh-TW')).toBe(false)
  })

  it('keeps the exact code winning over the aliased form for priority', () => {
    expect(selectedLanPriority(['zh-Hans', 'ja'], 'ja')).toBe(1)
    expect(selectedLanPriority(['ja', 'zh-Hans'], 'ai-zh')).toBe(1)
  })
})
