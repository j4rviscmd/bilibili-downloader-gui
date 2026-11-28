/**
 * Pins the checked-in theme-preset files to the generator and the vendored
 * tweakcn source, and locks the generation contract. Every assertion here
 * guards a bug that already shipped once from this generator:
 *
 * - stale checked-in output after a generator/source edit (in-sync guard)
 * - non-color tokens leaking in and rescaling the app's spacing
 * - non-hex colors reaching the splash hex math
 * - a light-mode selector that loses to the base `:root` token block
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildThemePresets, normalizeColor } from './generate-theme-presets.mjs'

const root = join(import.meta.dirname, '..')
const vendored = readFileSync(
  join(root, 'scripts/tweakcn-theme-presets.ts'),
  'utf8',
)
const built = buildThemePresets(vendored)

/** Every `--token: value;` declaration in the generated CSS. */
const declarations = [...built.css.matchAll(/^ {2}--([\w-]+): (.*);$/gm)].map(
  ([, key, value]) => ({ key, value }) as { key: string; value: string },
)

function contrastRatio(a: string, b: string): number {
  const linear = (hex: string, offset: number) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance = (hex: string) =>
    0.2126 * linear(hex, 1) + 0.7152 * linear(hex, 3) + 0.0722 * linear(hex, 5)
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

// Why: the AppBar icon buttons hover-paint bg-accent/80, i.e. accent at 80%
// alpha composited over the card surface — hover contrast must be measured
// against that composite, not raw accent (AppBarThemePresetButton.tsx /
// LanguageSwitcher.tsx, issue #995).
function alphaOver(fg: string, bg: string, alpha: number): string {
  const channel = (offset: number) => {
    const mixed = Math.round(
      alpha * Number.parseInt(fg.slice(offset, offset + 2), 16) +
        (1 - alpha) * Number.parseInt(bg.slice(offset, offset + 2), 16),
    )
    return mixed.toString(16).padStart(2, '0')
  }
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

describe('generate-theme-presets', () => {
  it('checked-in outputs are in sync with the generator and vendored source', () => {
    // If this fails, run `node scripts/generate-theme-presets.mjs`.
    expect(built.css).toBe(
      readFileSync(join(root, 'src/styles/theme-presets.css'), 'utf8'),
    )
    expect(built.ts).toBe(
      readFileSync(join(root, 'src/features/settings/themePresets.ts'), 'utf8'),
    )
  })

  it('adopts color tokens only', () => {
    expect(built.presets).toHaveLength(42)
    expect(built.missing).toEqual([])
    expect(declarations.length).toBeGreaterThan(2_000)
    for (const { key } of declarations) {
      expect(key).not.to.match(
        /^(font-|radius$|letter-spacing$|spacing$)/,
        `non-color token --${key} leaked into the preset CSS`,
      )
    }
    expect(built.css).not.toMatch(/box-shadow|text-shadow/)
  })

  it('emits hex colors (plus the brand-strong color-mix) only', () => {
    for (const { key, value } of declarations) {
      const isHex = /^#[0-9a-fA-F]{6}$/.test(value)
      const isBrandMix =
        key === 'brand-strong' &&
        /^color-mix\(in oklab, #[0-9a-fA-F]{6} 82%, black\)$/.test(value)
      expect(
        isHex || isBrandMix,
        `--${key}: ${value} is not a normalized color`,
      ).toBe(true)
    }
  })

  it('lists the presets alphabetically (picker order)', () => {
    const ids = built.presets.map((preset) => preset.id)
    expect(ids).toEqual([...ids].sort())
    expect(ids[0]).toBe('amber-minimal')
  })

  it('pairs the light selector so presets win over the base :root block', () => {
    for (const { id } of built.presets) {
      expect(built.css).toContain(
        `:root[data-theme-preset='${id}'],\n[data-theme-preset='${id}'] {`,
      )
      expect(built.css).toContain(`.dark[data-theme-preset='${id}'] {`)
    }
  })

  it('exposes per-mode accent and background hexes per preset', () => {
    const vercel = built.presets.find((preset) => preset.id === 'vercel')
    expect(vercel?.styles.light).toMatchObject({
      primary: '#000000',
      background: '#fcfcfc',
    })
    expect(vercel?.styles.dark).toMatchObject({
      primary: '#ffffff',
      background: '#000000',
    })
    expect(built.ts).toContain(
      "'vercel': { light: '#000000', dark: '#ffffff' },",
    )
  })

  it('normalizes oklch to hex and rejects unknown color forms', () => {
    expect(normalizeColor('#faf9f5')).toBe('#faf9f5')
    expect(normalizeColor('oklch(0.99 0 0)')).toBe('#fcfcfc')
    expect(normalizeColor('oklch(1.00 0 0)')).toBe('#ffffff')
    expect(normalizeColor('oklch(100% 0 0)')).toBe('#ffffff')
    expect(() => normalizeColor('rgb(0, 0, 0)')).toThrow(
      'unsupported color format',
    )
    expect(() => normalizeColor('oklch(none none none)')).toThrow(
      'unsupported oklch form',
    )
  })

  it('fails loudly when the vendored source format changes', () => {
    expect(() => buildThemePresets('')).toThrow(
      'expected ~42 presets, parsed 0',
    )
  })

  // Why: regression guard for issue #995 (AppBar text unreadable in most
  // tweakcn dark presets): presets are regenerated wholesale, so every
  // card/text pair is re-checked on each generation. Thresholds are WCAG AA:
  // 4.5:1 for normal text, 3:1 for icons (the only remaining muted-foreground
  // use on the app bar).
  it('keeps the app-bar token pairs readable in every preset', () => {
    const unreadable = built.presets.flatMap(({ id, styles }) =>
      ['light', 'dark'].flatMap((mode) => {
        const {
          card,
          'card-foreground': text,
          'muted-foreground': muted,
        } = styles[mode]
        return [
          ...(contrastRatio(text, card) < 4.5 ? [`${mode} card text`] : []),
          ...(contrastRatio(muted, card) < 3 ? [`${mode} muted icon`] : []),
        ].map((pair) => `${id} ${pair}`)
      }),
    )
    expect(unreadable).toEqual([])
  })

  it('keeps the app-bar icon hover text readable in every preset', () => {
    const unreadable = built.presets.flatMap(({ id, styles }) =>
      ['light', 'dark'].flatMap((mode) => {
        const { accent, card } = styles[mode]
        // Note: must mirror the AppBar icon buttons' hover classes —
        // hover:text-foreground dark:hover:text-accent-foreground
        // (AppBarThemePresetButton.tsx, LanguageSwitcher.tsx); change the
        // classes and this line together.
        const hoverText = mode === 'dark' ? 'accent-foreground' : 'foreground'
        const ratio = contrastRatio(
          styles[mode][hoverText],
          alphaOver(accent, card, 0.8),
        )
        return ratio < 3 ? [`${id} ${mode} hover icon`] : []
      }),
    )
    expect(unreadable).toEqual([])
  })
})
