import { describe, expect, it } from 'vitest'

import { resolveSplashPalette } from './constants'

describe('resolveSplashPalette', () => {
  it('returns the light palette for light theme', () => {
    const palette = resolveSplashPalette(false)
    expect(palette.background).toBe(0xf5f7fa)
    expect(palette.particleShades).toHaveLength(4)
  })

  it('returns the dark palette with a dark backdrop for dark theme', () => {
    expect(resolveSplashPalette(true).background).toBe(0x0f172a)
  })

  it('keeps the brand blues shared across themes', () => {
    const light = resolveSplashPalette(false)
    const dark = resolveSplashPalette(true)
    // #00A1D6 and #0088BB are identical in both palettes.
    expect(dark.particleShades[0]).toEqual(light.particleShades[0])
    expect(dark.particleShades[2]).toEqual(light.particleShades[2])
  })

  it('brightens the pale particle shades for the dark backdrop', () => {
    const light = resolveSplashPalette(false)
    const dark = resolveSplashPalette(true)
    // The two pale blues (#33B5E5, #66CCFF) get a higher green channel.
    expect(dark.particleShades[1][1]).toBeGreaterThan(
      light.particleShades[1][1],
    )
    expect(dark.particleShades[3][1]).toBeGreaterThan(
      light.particleShades[3][1],
    )
  })

  it('keeps all shades within the normalized 0-1 range', () => {
    for (const palette of [
      resolveSplashPalette(false),
      resolveSplashPalette(true),
    ]) {
      for (const [r, g, b] of palette.particleShades) {
        for (const c of [r, g, b]) {
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
