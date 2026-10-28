import { describe, expect, it } from 'vitest'

import { resolveSplashPalette, SPLASH_DOM_COLORS } from './constants'

describe('resolveSplashPalette', () => {
  it('returns the light palette for light theme', () => {
    const palette = resolveSplashPalette(false)
    expect(palette.background).toBe(0xf5f7fa)
    expect(palette.particleShades).toHaveLength(4)
  })

  it('returns the dark palette with a dark backdrop for dark theme', () => {
    expect(resolveSplashPalette(true).background).toBe(0x0f172a)
  })

  it('defaults to the pink accent', () => {
    const palette = resolveSplashPalette(false)
    expect(palette.accent).toBe(0xfb7299)
    expect(palette.particleShades[0]).toEqual([251 / 255, 114 / 255, 153 / 255])
  })

  it('returns the blue palette when the accent is blue', () => {
    const palette = resolveSplashPalette(false, 'blue')
    expect(palette.accent).toBe(0x00a1d6)
    expect(palette.particleShades[0]).toEqual([0, 161 / 255, 214 / 255])
  })

  it('keeps the shared shades identical across themes per accent', () => {
    for (const accent of ['pink', 'blue'] as const) {
      const light = resolveSplashPalette(false, accent)
      const dark = resolveSplashPalette(true, accent)
      // Base and darker shades are shared (#fb7299/#d84f7d, #00A1D6/#0088BB);
      // only the pale ones differ.
      expect(dark.particleShades[0]).toEqual(light.particleShades[0])
      expect(dark.particleShades[2]).toEqual(light.particleShades[2])
      expect(dark.accent).toBe(light.accent)
      expect(dark.background).toBe(0x0f172a)
    }
  })

  it('brightens the pale particle shades for the dark backdrop', () => {
    for (const accent of ['pink', 'blue'] as const) {
      const light = resolveSplashPalette(false, accent)
      const dark = resolveSplashPalette(true, accent)
      // The two pale shades get a higher green channel on the dark backdrop.
      expect(dark.particleShades[1][1]).toBeGreaterThan(
        light.particleShades[1][1],
      )
      expect(dark.particleShades[3][1]).toBeGreaterThan(
        light.particleShades[3][1],
      )
    }
  })

  it('keeps all shades within the normalized 0-1 range', () => {
    for (const accent of ['pink', 'blue'] as const) {
      for (const dark of [false, true]) {
        for (const [r, g, b] of resolveSplashPalette(dark, accent)
          .particleShades) {
          for (const c of [r, g, b]) {
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('exposes DOM colors matching each 3D accent family', () => {
    expect(SPLASH_DOM_COLORS.pink.hex).toBe('#fb7299')
    expect(SPLASH_DOM_COLORS.pink.glowRgb).toBe('251,114,153')
    expect(SPLASH_DOM_COLORS.blue.hex).toBe('#00A1D6')
    expect(SPLASH_DOM_COLORS.blue.glowRgb).toBe('0,161,214')
  })
})
