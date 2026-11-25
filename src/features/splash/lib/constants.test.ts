import { describe, expect, it } from 'vitest'

import {
  resolveSplashPalette,
  SPLASH_DOM_COLORS,
  splashBackgroundCss,
  splashDomColor,
} from './constants'

describe('resolveSplashPalette', () => {
  it('returns the light palette for light theme', () => {
    const palette = resolveSplashPalette(false)
    expect(palette.background).toBe(0xf5f7fa)
    expect(palette.particleShades).toHaveLength(4)
  })

  it('returns the dark palette with a dark backdrop for dark theme', () => {
    expect(resolveSplashPalette(true).background).toBe(0x0f172a)
  })

  it('defaults to the bilibili preset', () => {
    const palette = resolveSplashPalette(false)
    expect(palette.accent).toBe(0xfb7299)
    expect(palette.particleShades[0]).toEqual([251 / 255, 114 / 255, 153 / 255])
  })

  it('returns the blue palette for the bilibili-blue preset', () => {
    const palette = resolveSplashPalette(false, 'bilibili-blue')
    expect(palette.accent).toBe(0x00a1d6)
    expect(palette.particleShades[0]).toEqual([0, 161 / 255, 214 / 255])
  })

  it('derives the palette for a tweakcn preset from its DOM hex', () => {
    const palette = resolveSplashPalette(false, 'catppuccin')
    expect(palette.accent).toBe(0x8839ef)
    // The backdrop follows the preset's own background color.
    expect(palette.background).toBe(0xeff1f5)
    expect(palette.particleShades[0]).toEqual([136 / 255, 57 / 255, 239 / 255])
    expect(palette.particleShades).toHaveLength(4)
    expect(resolveSplashPalette(true, 'catppuccin').background).toBe(0x181825)
  })

  it('keeps the shared shades identical across themes for the bilibili pair', () => {
    for (const preset of ['bilibili', 'bilibili-blue'] as const) {
      const light = resolveSplashPalette(false, preset)
      const dark = resolveSplashPalette(true, preset)
      // Base and darker shades are shared (#fb7299/#d84f7d, #00A1D6/#0088BB);
      // only the pale ones differ.
      expect(dark.particleShades[0]).toEqual(light.particleShades[0])
      expect(dark.particleShades[2]).toEqual(light.particleShades[2])
      expect(dark.accent).toBe(light.accent)
    }
  })

  it('derives tweakcn base shades from the per-mode accent', () => {
    for (const preset of ['catppuccin', 'graphite'] as const) {
      for (const dark of [false, true]) {
        const palette = resolveSplashPalette(dark, preset)
        expect(palette.particleShades[0]).toEqual([
          ((palette.accent >> 16) & 0xff) / 255,
          ((palette.accent >> 8) & 0xff) / 255,
          (palette.accent & 0xff) / 255,
        ])
      }
    }
  })

  it('brightens the pale particle shades for the dark backdrop', () => {
    for (const preset of [
      'bilibili',
      'bilibili-blue',
      'catppuccin',
      'graphite',
    ] as const) {
      const light = resolveSplashPalette(false, preset)
      const dark = resolveSplashPalette(true, preset)
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
    for (const preset of [
      'bilibili',
      'bilibili-blue',
      'catppuccin',
      'graphite',
    ] as const) {
      for (const dark of [false, true]) {
        for (const [r, g, b] of resolveSplashPalette(dark, preset)
          .particleShades) {
          for (const c of [r, g, b]) {
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('exposes DOM colors matching each 3D preset family', () => {
    expect(SPLASH_DOM_COLORS.bilibili.light.hex).toBe('#fb7299')
    expect(SPLASH_DOM_COLORS.bilibili.dark.glowRgb).toBe('251,114,153')
    expect(SPLASH_DOM_COLORS['bilibili-blue'].light.hex).toBe('#00A1D6')
    expect(SPLASH_DOM_COLORS['bilibili-blue'].dark.glowRgb).toBe('0,161,214')
    expect(SPLASH_DOM_COLORS.catppuccin.light.hex).toBe('#8839ef')
    expect(SPLASH_DOM_COLORS.catppuccin.light.glowRgb).toBe('136,57,239')
  })

  it('follows the preset primary per mode (vercel: black-on-light, white-on-dark)', () => {
    expect(splashDomColor(false, 'vercel').hex).toBe('#000000')
    expect(splashDomColor(true, 'vercel').hex).toBe('#ffffff')
    // The 3D palette derives from the same per-mode accent.
    expect(resolveSplashPalette(false, 'vercel').accent).toBe(0x000000)
    expect(resolveSplashPalette(false, 'vercel').background).toBe(0xfcfcfc)
    expect(resolveSplashPalette(true, 'vercel').accent).toBe(0xffffff)
    expect(resolveSplashPalette(true, 'vercel').background).toBe(0x000000)
  })

  it('exposes the DOM backdrop per preset and mode', () => {
    // The bilibili pair keeps the established backdrops.
    expect(splashBackgroundCss(false, 'bilibili')).toBe('#f5f7fa')
    expect(splashBackgroundCss(true, 'bilibili')).toBe('#0f172a')
    expect(splashBackgroundCss(false, 'bilibili-blue')).toBe('#f5f7fa')
    expect(splashBackgroundCss(true, 'bilibili-blue')).toBe('#0f172a')
    // tweakcn presets follow their own background tokens.
    expect(splashBackgroundCss(false, 'catppuccin')).toBe('#eff1f5')
    expect(splashBackgroundCss(true, 'catppuccin')).toBe('#181825')
    // oklch values from the vendored source are normalized to hex.
    expect(splashBackgroundCss(false, 'vercel')).toBe('#fcfcfc')
    expect(splashBackgroundCss(true, 'vercel')).toBe('#000000')
  })
})
