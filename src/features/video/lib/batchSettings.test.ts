import { describe, expect, it } from 'vitest'
import {
  LOGIN_REQUIRED_VIDEO_IDS,
  VIDEO_LADDER_IDS,
  predictAdjustment,
  resolveTarget,
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
