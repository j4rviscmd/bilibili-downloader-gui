// Generates src/styles/theme-presets.css and src/features/settings/themePresets.ts
// from the vendored tweakcn preset definitions (scripts/tweakcn-theme-presets.ts).
//
// Source: https://github.com/jnsahaj/tweakcn (Apache-2.0)
// Re-sync: overwrite scripts/tweakcn-theme-presets.ts from the repo above,
// then run `node scripts/generate-theme-presets.mjs`.
//
// Only color tokens are adopted (fonts/radius/spacing are intentionally
// dropped to preserve the app's typography, font-size setting, and
// Tailwind spacing scale). Community presets
// are not AA-contrast guaranteed; the default `bilibili` preset is.
//
// The pure builders are exported for scripts/generate-theme-presets.test.ts,
// which also pins the checked-in outputs to this generator.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const root = join(dirname(scriptPath), '..')

const SKIP_KEYS = /^(font-|radius$|letter-spacing$|spacing$|.*shadow)/

// tweakcn mostly stores hex; a few presets (e.g. vercel) use oklch().
// Everything downstream (CSS vars, splash hex math) consumes hex, so
// normalize at generation time and fail loudly on anything else.
export function oklchToHex(value) {
  const m = value.match(/^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\)$/)
  if (!m) throw new Error(`unsupported oklch form: ${value}`)
  const lPct = parseFloat(m[1])
  const l = lPct > 1 ? lPct / 100 : lPct
  const c = parseFloat(m[2])
  const h = parseFloat(m[3])
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const [rl, gm, sl] = [l_, m_, s_].map((v) => v ** 3)
  const rgb = [
    4.0767416621 * rl - 3.3077115913 * gm + 0.2309699292 * sl,
    -1.2684380046 * rl + 2.6097574011 * gm - 0.3413193965 * sl,
    -0.0041960863 * rl - 0.7034186147 * gm + 1.707614701 * sl,
  ].map((v) => {
    v = Math.min(1, Math.max(0, v))
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, e)) * 255)
  })
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function normalizeColor(value) {
  if (value.startsWith('#')) return value
  if (value.startsWith('oklch(')) return oklchToHex(value)
  throw new Error(`unsupported color format: ${value}`)
}

export function parsePresets(src) {
  const presets = []
  const blockRe = /^  "?([a-zA-Z0-9_-]+)"?: \{([\s\S]*?)^  \},$/gm
  for (const [, id, body] of src.matchAll(blockRe)) {
    const label = body.match(/label: "([^"]+)"/)?.[1]
    const styles = {}
    for (const mode of ['light', 'dark']) {
      const modeMatch = body.match(
        new RegExp(String.raw`${mode}: \{([\s\S]*?)\n      \}`),
      )
      if (!modeMatch) continue
      const vars = {}
      for (const [, key, value] of modeMatch[1].matchAll(
        /"?([a-zA-Z0-9-]+)"?: "([^"]+)"/g,
      )) {
        if (!SKIP_KEYS.test(key)) vars[key] = normalizeColor(value)
      }
      styles[mode] = vars
    }
    if (label && styles.light && styles.dark)
      presets.push({ id, label, styles })
  }
  return presets
}

const cssVars = (vars, indent) =>
  Object.entries(vars)
    .map(([key, value]) => `${indent}--${key}: ${value};`)
    .join('\n')

/**
 * Builds both generated files (as strings) from the vendored tweakcn
 * source text. Pure: no filesystem access, so tests can pin the
 * checked-in outputs to it.
 */
export function buildThemePresets(source) {
  // Alphabetical after the hand-defined bilibili pair (picker order).
  const presets = parsePresets(source).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  if (presets.length < 40) {
    throw new Error(
      `expected ~42 presets, parsed ${presets.length} — check the vendored source format`,
    )
  }

  const cssBlocks = presets
    .map(({ id, styles }) => {
      const light = { ...styles.light }
      const dark = { ...styles.dark }
      // Brand tokens drive the app's CTA/mark/splash utilities: the preset's
      // primary becomes the brand color; light mode keeps the darkened-CTA
      // pattern via color-mix (mirrors the bilibili presets' #be185d rule).
      light['brand'] = styles.light['primary']
      light['brand-strong'] =
        `color-mix(in oklab, ${styles.light['primary']} 82%, black)`
      light['brand-foreground'] =
        styles.light['primary-foreground'] ?? '#ffffff'
      dark['brand'] = styles.dark['primary']
      dark['brand-strong'] = styles.dark['primary']
      dark['brand-foreground'] = styles.dark['primary-foreground'] ?? '#ffffff'
      // The light block pairs a :root selector with the bare attribute
      // one: on <html> only the :root form (0,2,0) outranks the base :root
      // token block; the bare form lets any container (the theme onboarding
      // preview) pin the same tokens.
      return `:root[data-theme-preset='${id}'],
[data-theme-preset='${id}'] {
${cssVars(light, '  ')}
}

.dark[data-theme-preset='${id}'] {
${cssVars(dark, '  ')}
}`
    })
    .join('\n\n')

  const css = `/* GENERATED by scripts/generate-theme-presets.mjs — do not edit by hand.
 *
 * Theme presets from tweakcn (https://github.com/jnsahaj/tweakcn), Apache-2.0.
 * Colors only: font/radius/spacing declarations are intentionally not adopted.
 * Community presets are not WCAG-AA contrast guaranteed; the default
 * \`bilibili\` preset (no attribute) is.
 */
${cssBlocks}
`

  const presetIds = presets.map((p) => `  '${p.id}',`).join('\n')
  const options = presets
    .map(({ id, styles }) => {
      const swatch = styles.light['primary']
      return `  { id: '${id}', labelKey: 'settings.theme_${id}', swatch: '${swatch}' },`
    })
    .join('\n')
  const accentHexes = presets
    .map(
      ({ id, styles }) =>
        `  '${id}': { light: '${styles.light['primary']}', dark: '${styles.dark['primary']}' },`,
    )
    .join('\n')
  const backgroundHexes = presets
    .map(
      ({ id, styles }) =>
        `  '${id}': { light: '${styles.light['background']}', dark: '${styles.dark['background']}' },`,
    )
    .join('\n')

  const ts = `// GENERATED by scripts/generate-theme-presets.mjs — do not edit by hand.
// Source: tweakcn (https://github.com/jnsahaj/tweakcn), Apache-2.0).

export const TWEAKCN_PRESET_IDS = [
${presetIds}
] as const

export type TweakcnPresetId = (typeof TWEAKCN_PRESET_IDS)[number]

export interface ThemePresetOption {
  id: TweakcnPresetId
  labelKey: string
  swatch: string
}

/** tweakcn presets only; the bilibili/bilibili-blue pair is hand-defined. */
export const TWEAKCN_THEME_PRESETS: readonly ThemePresetOption[] = [
${options}
]

/** Per-mode primary hex (splash DOM colors + 3D palette follow the mode —
 *  e.g. vercel is black-on-light but white-on-dark). */
export const TWEAKCN_PRESET_ACCENTS: Readonly<
  Record<TweakcnPresetId, { light: string; dark: string }>
> = {
${accentHexes}
}

/** Per-mode background hex (splash backdrop follows the preset). */
export const TWEAKCN_PRESET_BACKGROUNDS: Readonly<
  Record<TweakcnPresetId, { light: string; dark: string }>
> = {
${backgroundHexes}
}
`

  const missing = presets.filter(
    (p) => !p.styles.light['primary'] || !p.styles.dark['primary'],
  )
  return { css, ts, presets, missing }
}

function main() {
  const source = readFileSync(
    join(root, 'scripts/tweakcn-theme-presets.ts'),
    'utf8',
  )
  const { css, ts, presets, missing } = buildThemePresets(source)
  writeFileSync(join(root, 'src/styles/theme-presets.css'), css)
  writeFileSync(join(root, 'src/features/settings/themePresets.ts'), ts)
  console.log(
    `presets: ${presets.length}, css: src/styles/theme-presets.css, ts: src/features/settings/themePresets.ts` +
      (missing.length
        ? `, without primary: ${missing.map((p) => p.id).join(', ')}`
        : ''),
  )
}

// Run only when executed directly, not when the test imports the builders.
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  main()
}
