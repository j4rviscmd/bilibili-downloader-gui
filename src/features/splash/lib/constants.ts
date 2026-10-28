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
 * Splash accent, mirroring settings ≫ accentColor ('pink' | 'blue').
 * Pink is the app default and the fallback when the URL param is absent.
 */
export type SplashAccent = 'pink' | 'blue'

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

/** Resolves the theme/accent-dependent 3D scene palette. */
export function resolveSplashPalette(
  dark: boolean,
  accent: SplashAccent = 'pink',
): SplashPalette {
  if (accent === 'blue') {
    return dark ? DARK_PALETTE_BLUE : LIGHT_PALETTE_BLUE
  }
  return dark ? DARK_PALETTE_PINK : LIGHT_PALETTE_PINK
}
