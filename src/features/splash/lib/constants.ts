import {
  TWEAKCN_PRESET_ACCENTS,
  TWEAKCN_PRESET_BACKGROUNDS,
  type TweakcnPresetId,
} from '@/features/settings/themePresets'
import type { ThemePreset } from '@/features/settings/type'

/** Duration (ms) of the CSS opacity fade-out transition. */
export const FADE_DURATION_MS = 700
/**
 * Maximum time (ms) to wait for the web font to finish loading during the
 * splash phase before proceeding. Guards against slow networks stalling
 * startup; the font-family fallback chain still applies on timeout.
 */
export const FONT_LOAD_TIMEOUT_MS = 4_000

/** Number of floating particles in the 3D scene. */
export const PARTICLE_COUNT = 150
/** Maximum distance between two particles for a connecting line to appear. */
export const CONNECTION_DISTANCE = 5
/** Half-extent of the cubic bounding box that particles occupy. */
export const BOUNDS = 20

/** Y-axis rotation speed (radians per second) of the scene group. */
export const ROTATION_SPEED_Y = 0.05
/** X-axis rotation speed (radians per second) of the scene group. */
export const ROTATION_SPEED_X = 0.02

// Little TV shape dimensions
export const TV_WIDTH = 8
export const TV_HEIGHT = 6
export const TV_DEPTH = 2.5
export const TV_CORNER_RADIUS = 0.8
export const ANTENNA_SPREAD = 1.2
export const ANTENNA_HEIGHT = 1.5

// Lightning bolt settings
/** Number of lightning bolts emitted from each antenna tip. */
export const BOLTS_PER_ANTENNA = 4
/** Number of line segments that make up a single lightning bolt. */
export const SEGMENTS_PER_BOLT = 6
/** Total length of each lightning bolt in world units. */
export const BOLT_LENGTH = 3.5
/** Interval (seconds) between lightning position refreshes. */
export const BOLT_REFRESH_SEC = 0.08
/** Radius of the sphere placed at each antenna tip. */
export const TIP_RADIUS = 0.25

/**
 * Splash theme preset, mirroring settings ≫ themePreset. Bilibili is
 * the app default and the fallback when the URL param is absent.
 */
export type SplashPreset = ThemePreset

function hexToGlowRgb(hex: string): string {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ].join(',')
}

/** DOM-side accent colors: title span fill, glow shadow, ffmpeg bar fill. */
interface SplashDomColor {
  hex: string
  glowRgb: string
}

const BILIBILI_DOM_COLORS: Record<
  'bilibili' | 'bilibili-blue',
  SplashDomColor
> = {
  // Bilibili pink — matches the app's `--brand` pink (#fb7299).
  bilibili: { hex: '#fb7299', glowRgb: '251,114,153' },
  // Bilibili blue — the splash's own established blue (predates the
  // `--brand` blue #00aeec); kept so bilibili-blue users see no visual
  // change. Note: splash has rendered #00A1D6 since its first 3D scene
  // (32b05ac, 2026-06); the `--brand` blue #00aeec only landed later
  // (b652305, 2026-10).
  'bilibili-blue': { hex: '#00A1D6', glowRgb: '0,161,214' },
}

// tweakcn presets: the preset's per-mode primary drives the DOM colors
// (e.g. vercel is black-on-light but white-on-dark).
const TWEAKCN_DOM_COLORS = Object.fromEntries(
  Object.entries(TWEAKCN_PRESET_ACCENTS).map(([id, accents]) => [
    id,
    {
      light: { hex: accents.light, glowRgb: hexToGlowRgb(accents.light) },
      dark: { hex: accents.dark, glowRgb: hexToGlowRgb(accents.dark) },
    },
  ]),
) as Record<TweakcnPresetId, { light: SplashDomColor; dark: SplashDomColor }>

// The bilibili pair renders the same colorway in both modes.
export const SPLASH_DOM_COLORS: Record<
  SplashPreset,
  { light: SplashDomColor; dark: SplashDomColor }
> = {
  bilibili: {
    light: BILIBILI_DOM_COLORS.bilibili,
    dark: BILIBILI_DOM_COLORS.bilibili,
  },
  'bilibili-blue': {
    light: BILIBILI_DOM_COLORS['bilibili-blue'],
    dark: BILIBILI_DOM_COLORS['bilibili-blue'],
  },
  ...TWEAKCN_DOM_COLORS,
}

/** Mode-aware DOM accent (title span, glow, ffmpeg bar). */
export function splashDomColor(
  dark: boolean,
  preset: SplashPreset = 'bilibili',
): SplashDomColor {
  return SPLASH_DOM_COLORS[preset][dark ? 'dark' : 'light']
}

/**
 * Theme- and preset-dependent 3D scene palette (background clear color +
 * TV/lightning accent + particle shades). The backdrop follows the preset's
 * own background color; only the bilibili pair keeps the neutral one.
 */
export interface SplashPalette {
  /** WebGL clear color behind the particle cloud. */
  background: number
  /** Accent fill for the TV body/edges/screen, lightning, and antenna tips. */
  accent: number
  /** Normalized RGB shades for particle vertex colors (0-1 range). */
  particleShades: readonly (readonly [number, number, number])[]
}

const LIGHT_PALETTE_BLUE: SplashPalette = {
  accent: 0x00a1d6,
  background: 0xf5f7fa,
  particleShades: [
    [0 / 255, 161 / 255, 214 / 255], // #00A1D6 Bilibili Blue
    [51 / 255, 181 / 255, 229 / 255], // #33B5E5
    [0 / 255, 136 / 255, 187 / 255], // #0088BB
    [102 / 255, 204 / 255, 255 / 255], // #66CCFF
  ],
}

// Why brighten only the two pale blues: #00A1D6 and #0088BB hold enough
// contrast on the dark backdrop, while the lighter shades would sink into it.
const DARK_PALETTE_BLUE: SplashPalette = {
  // Note: must stay identical to the DOM container background
  // (splashBackgroundCss(true, 'bilibili-blue') in SplashScreen.tsx) — the
  // WebGL clear color and the CSS background are the same visual surface.
  accent: 0x00a1d6,
  background: 0x0f172a,
  particleShades: [
    [0 / 255, 161 / 255, 214 / 255], // #00A1D6 Bilibili Blue
    [91 / 255, 198 / 255, 240 / 255], // #5BC6F0 (lightened #33B5E5)
    [0 / 255, 136 / 255, 187 / 255], // #0088BB
    [143 / 255, 217 / 255, 255 / 255], // #8FD9FF (lightened #66CCFF)
  ],
}

// Bilibili pink (#fb7299) family, mirroring the blue set's structure:
// base / lighter / darker / pale.
const LIGHT_PALETTE_PINK: SplashPalette = {
  accent: 0xfb7299,
  background: 0xf5f7fa,
  particleShades: [
    [251 / 255, 114 / 255, 153 / 255], // #fb7299 Bilibili Pink
    [252 / 255, 139 / 255, 171 / 255], // #fc8bab
    [216 / 255, 79 / 255, 125 / 255], // #d84f7d
    [253 / 255, 164 / 255, 191 / 255], // #fda4bf
  ],
}

// Same dark-mode rule as the blues: brighten only the two pale shades.
const DARK_PALETTE_PINK: SplashPalette = {
  accent: 0xfb7299,
  background: 0x0f172a,
  particleShades: [
    [251 / 255, 114 / 255, 153 / 255], // #fb7299 Bilibili Pink
    [253 / 255, 157 / 255, 187 / 255], // #fd9dbb (lightened #fc8bab)
    [216 / 255, 79 / 255, 125 / 255], // #d84f7d
    [254 / 255, 199 / 255, 220 / 255], // #fec7dc (lightened #fda4bf)
  ],
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function shadeRgb(
  rgb: readonly [number, number, number],
  lightnessDelta: number,
  saturationDelta: number,
): [number, number, number] {
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  const l = Math.min(1, Math.max(0, lightness + lightnessDelta))
  const s = Math.min(1, Math.max(0, saturation + saturationDelta))
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - chroma / 2
  const sector = Math.floor(hue / 60)
  let rgb2: [number, number, number]
  if (sector === 0) rgb2 = [chroma, x, 0]
  else if (sector === 1) rgb2 = [x, chroma, 0]
  else if (sector === 2) rgb2 = [0, chroma, x]
  else if (sector === 3) rgb2 = [0, x, chroma]
  else if (sector === 4) rgb2 = [x, 0, chroma]
  else rgb2 = [chroma, 0, x]
  const [r2, g2, b2] = rgb2
  return [
    Math.round((r2 + m) * 255),
    Math.round((g2 + m) * 255),
    Math.round((b2 + m) * 255),
  ]
}

// Derives the base/lighter/darker/pale particle family from the accent
// hex, mirroring the hand-tuned pink/blue families' lightness deltas;
// dark mode brightens the two light shades (same rule as pink/blue).
// The backdrop follows the preset's own background color.
function derivePalette(
  dark: boolean,
  hex: string,
  backgroundHex: string,
): SplashPalette {
  const base = hexToRgb(hex)
  const [br, bg, bb] = hexToRgb(backgroundHex)
  const shades = [
    base,
    shadeRgb(base, dark ? 0.1 : 0.06, 0),
    shadeRgb(base, -0.14, 0),
    shadeRgb(base, dark ? 0.24 : 0.13, -0.12),
  ]
  return {
    accent: (base[0] << 16) | (base[1] << 8) | base[2],
    background: (br << 16) | (bg << 8) | bb,
    particleShades: shades.map(
      ([r, g, b]) => [r / 255, g / 255, b / 255] as const,
    ),
  }
}

/** Resolves the theme/preset-dependent 3D scene palette. */
export function resolveSplashPalette(
  dark: boolean,
  preset: SplashPreset = 'bilibili',
): SplashPalette {
  // Why: the bilibili pair keeps its hand-tuned families instead of
  // derivePalette — the HSL approximation does not reproduce their exact
  // shades (values are pinned by the palette tests and the blue heritage
  // note above), so existing users see no visual change (same verbatim
  // rule as VERBATIM_FILLS in src/shared/ui/BilibiliTvMark.tsx).
  if (preset === 'bilibili') {
    return dark ? DARK_PALETTE_PINK : LIGHT_PALETTE_PINK
  }
  if (preset === 'bilibili-blue') {
    return dark ? DARK_PALETTE_BLUE : LIGHT_PALETTE_BLUE
  }
  const bg = TWEAKCN_PRESET_BACKGROUNDS[preset]
  const accent = TWEAKCN_PRESET_ACCENTS[preset]
  return derivePalette(
    dark,
    dark ? accent.dark : accent.light,
    dark ? bg.dark : bg.light,
  )
}

/** CSS backdrop color for the splash DOM container (= WebGL clear color). */
export function splashBackgroundCss(
  dark: boolean,
  preset: SplashPreset = 'bilibili',
): string {
  if (preset === 'bilibili' || preset === 'bilibili-blue') {
    return dark ? '#0f172a' : '#f5f7fa'
  }
  const bg = TWEAKCN_PRESET_BACKGROUNDS[preset]
  return dark ? bg.dark : bg.light
}
