import { describe, expect, it } from 'vitest'

import {
  BITRATE_PRESETS,
  DEFAULT_BITRATE_KBPS,
  MIN_BITRATE_KBPS,
  getEnabledPresets,
  selectBestEffortBitrate,
} from './bitrate'

describe('getEnabledPresets', () => {
  it('returns all presets when input bitrate is unknown', () => {
    expect(getEnabledPresets(null)).toEqual(BITRATE_PRESETS)
  })

  it('excludes presets that exceed the input bitrate', () => {
    expect(getEnabledPresets(160)).toEqual([128])
  })

  it('keeps the floor preset even when input is below it', () => {
    expect(getEnabledPresets(96)).toEqual([128])
  })

  it('includes all presets up to the input bitrate', () => {
    expect(getEnabledPresets(256)).toEqual([128, 192, 256])
  })

  it('includes every preset when input is very high', () => {
    expect(getEnabledPresets(500)).toEqual(BITRATE_PRESETS)
  })
})

describe('selectBestEffortBitrate', () => {
  it('returns the default when input bitrate is unknown', () => {
    expect(selectBestEffortBitrate(null)).toBe(DEFAULT_BITRATE_KBPS)
  })

  it('picks the largest preset not exceeding the input', () => {
    expect(selectBestEffortBitrate(160)).toBe(128)
    expect(selectBestEffortBitrate(200)).toBe(192)
    expect(selectBestEffortBitrate(300)).toBe(256)
  })

  it('falls back to the floor when input is below every preset', () => {
    expect(selectBestEffortBitrate(96)).toBe(MIN_BITRATE_KBPS)
  })

  it('selects the highest preset when input is very high', () => {
    expect(selectBestEffortBitrate(500)).toBe(320)
  })
})
