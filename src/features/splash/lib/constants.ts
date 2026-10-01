/** Minimum time (ms) the splash screen stays visible regardless of init speed. */
export const MIN_DISPLAY_MS = 2_000
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

/** Color palette for all 3D elements (hex values matching the Bilibili brand). */
export const COLORS = {
  tvBody: 0x00a1d6,
  tvEdge: 0x00a1d6,
  tvScreen: 0x00a1d6,
  connections: 0x00a1d6,
  lightning: 0x00a1d6,
  tipAccent: 0x00a1d6,
} as const

/**
 * Theme-dependent 3D scene palette (background clear color + particle
 * shades). TV/lightning accent blues stay shared across themes (COLORS);
 * only the backdrop and the pale particle blues differ.
 */
export interface SplashPalette {
  /** WebGL clear color behind the particle cloud. */
  background: number
  /** Normalized RGB shades for particle vertex colors (0-1 range). */
  particleShades: readonly (readonly [number, number, number])[]
}

const LIGHT_PALETTE: SplashPalette = {
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
const DARK_PALETTE: SplashPalette = {
  // Note: must stay identical to the DOM container background
  // (`dark:bg-[#0f172a]` in SplashScreen.tsx / SetupLanguage.tsx) — the WebGL
  // clear color and the CSS background are the same visual surface.
  background: 0x0f172a,
  particleShades: [
    [0 / 255, 161 / 255, 214 / 255], // #00A1D6 Bilibili Blue
    [91 / 255, 198 / 255, 240 / 255], // #5BC6F0 (lightened #33B5E5)
    [0 / 255, 136 / 255, 187 / 255], // #0088BB
    [143 / 255, 217 / 255, 255 / 255], // #8FD9FF (lightened #66CCFF)
  ],
}

/** Resolves the theme-dependent 3D scene palette. */
export function resolveSplashPalette(dark: boolean): SplashPalette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE
}
