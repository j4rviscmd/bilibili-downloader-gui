import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TARGET_HEIGHT,
  MIN_TARGET_HEIGHT,
  RESOLUTION_HEIGHT_PRESETS,
  getEnabledResolutions,
  selectBestEffortResolution,
} from './resolution'

describe('getEnabledResolutions', () => {
  it('returns all presets when the source height is unknown', () => {
    expect(getEnabledResolutions(null)).toEqual(RESOLUTION_HEIGHT_PRESETS)
  })

  it('excludes presets taller than the source', () => {
    expect(getEnabledResolutions(600)).toEqual([480, 360])
  })

  it('keeps the floor preset even when the source is shorter', () => {
    expect(getEnabledResolutions(240)).toEqual([360])
  })

  it('includes all presets up to the source height', () => {
    expect(getEnabledResolutions(720)).toEqual([720, 480, 360])
  })

  it('includes every preset when the source is very tall', () => {
    expect(getEnabledResolutions(2160)).toEqual(RESOLUTION_HEIGHT_PRESETS)
  })
})

describe('selectBestEffortResolution', () => {
  it('returns the default when the source height is unknown', () => {
    expect(selectBestEffortResolution(null)).toBe(DEFAULT_TARGET_HEIGHT)
  })

  // Why exact-match cases: a previous reverse() scan returned the SMALLEST
  // preset instead (360 for a 4K source) — fixed to the documented
  // "largest preset not exceeding the source" semantics.
  it('returns the largest preset not exceeding the source height', () => {
    expect(selectBestEffortResolution(2160)).toBe(1080)
    expect(selectBestEffortResolution(1080)).toBe(1080)
    expect(selectBestEffortResolution(1000)).toBe(720)
    expect(selectBestEffortResolution(600)).toBe(480)
  })

  it('falls back to the floor when the source is shorter than every preset', () => {
    expect(selectBestEffortResolution(240)).toBe(MIN_TARGET_HEIGHT)
  })
})
