import type { AccentColor } from '@/features/settings/type'

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
 * Splash accent, mirroring settings ≫ accentColor. Pink is the app
 * default and the fallback when the URL param is absent.
 */
export type SplashAccent = AccentColor

/** DOM-side accent colors: title span fill, glow shadow, ffmpeg bar fill. */
export const SPLASH_DOM_COLORS: Record<
  SplashAccent,
  { hex: string; glowRgb: string }
> = {
  // Bilibili pink — matches the app's `--brand` pink (#fb7299).
  pink: { hex: '#fb7299', glowRgb: '251,114,153' },
  // Bilibili blue — the splash's own established blue (predates the
  // `--brand` blue #00aeec); kept so blue-accent users see no visual change.
  // Note: splash has rendered #00A1D6 since its first 3D scene (32b05ac,
  // 2026-06); the `--brand` blue #00aeec only landed later (b652305, 2026-10).
  blue: { hex: '#00A1D6', glowRgb: '0,161,214' },
  // Shadcn/Tailwind hue accents: the 500 step of each hue (the same
  // value as the dark-mode `--brand` fill).
  red: { hex: '#FB2C36', glowRgb: '251,44,54' },
  orange: { hex: '#FF6900', glowRgb: '255,105,0' },
  amber: { hex: '#FE9A00', glowRgb: '254,154,0' },
  yellow: { hex: '#F0B100', glowRgb: '240,177,0' },
  lime: { hex: '#7CCF00', glowRgb: '124,207,0' },
  green: { hex: '#00C950', glowRgb: '0,201,80' },
  emerald: { hex: '#00BC7D', glowRgb: '0,188,125' },
  teal: { hex: '#00BBA7', glowRgb: '0,187,167' },
  cyan: { hex: '#00B8DB', glowRgb: '0,184,219' },
  sky: { hex: '#00A6F4', glowRgb: '0,166,244' },
  indigo: { hex: '#615FFF', glowRgb: '97,95,255' },
  violet: { hex: '#8E51FF', glowRgb: '142,81,255' },
  purple: { hex: '#AD46FF', glowRgb: '173,70,255' },
  fuchsia: { hex: '#E12AFB', glowRgb: '225,42,251' },
  rose: { hex: '#FF2056', glowRgb: '255,32,86' },
  slate: { hex: '#62748E', glowRgb: '98,116,142' },
  gray: { hex: '#6A7282', glowRgb: '106,114,130' },
  zinc: { hex: '#71717B', glowRgb: '113,113,123' },
  neutral: { hex: '#737373', glowRgb: '115,115,115' },
  stone: { hex: '#79716B', glowRgb: '121,113,107' },
  mauve: { hex: '#79697B', glowRgb: '121,105,123' },
  olive: { hex: '#7C7C67', glowRgb: '124,124,103' },
  mist: { hex: '#67787C', glowRgb: '103,120,124' },
  taupe: { hex: '#7C6D67', glowRgb: '124,109,103' },
}

/**
 * Theme- and accent-dependent 3D scene palette (background clear color +
 * TV/lightning accent + particle shades). The backdrop is neutral and shared
 * across accents; only the accent family differs.
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
  // (`dark:bg-[#0f172a]` in SplashScreen.tsx / SetupLanguage.tsx) — the WebGL
  // clear color and the CSS background are the same visual surface.
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

const LIGHT_BACKGROUND = 0xf5f7fa
const DARK_BACKGROUND = 0x0f172a

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
function derivePalette(dark: boolean, hex: string): SplashPalette {
  const base = hexToRgb(hex)
  const shades = [
    base,
    shadeRgb(base, dark ? 0.1 : 0.06, 0),
    shadeRgb(base, -0.14, 0),
    shadeRgb(base, dark ? 0.24 : 0.13, -0.12),
  ]
  return {
    accent: (base[0] << 16) | (base[1] << 8) | base[2],
    background: dark ? DARK_BACKGROUND : LIGHT_BACKGROUND,
    particleShades: shades.map(
      ([r, g, b]) => [r / 255, g / 255, b / 255] as const,
    ),
  }
}

/** Resolves the theme/accent-dependent 3D scene palette. */
export function resolveSplashPalette(
  dark: boolean,
  accent: SplashAccent = 'pink',
): SplashPalette {
  // Why: pink/blue keep their hand-tuned families instead of derivePalette —
  // the HSL approximation does not reproduce their exact shades (values are
  // pinned by the palette tests and the blue heritage note above), so existing
  // users see no visual change (same verbatim rule as VERBATIM_FILLS in
  // src/shared/ui/BilibiliTvMark.tsx).
  if (accent === 'pink') {
    return dark ? DARK_PALETTE_PINK : LIGHT_PALETTE_PINK
  }
  if (accent === 'blue') {
    return dark ? DARK_PALETTE_BLUE : LIGHT_PALETTE_BLUE
  }
  return derivePalette(dark, SPLASH_DOM_COLORS[accent].hex)
}
