import type { AccentColor } from '@/features/settings/type'

export interface AccentColorOption {
  value: AccentColor
  labelKey: string
  swatch: string
}

// Note: swatch values mirror the light-mode `--brand` tokens in
// src/styles/index.css (pink/blue as hex, the rest verbatim Tailwind v4
// oklch) — keep both sides in sync so the picker previews the real color.
export const ACCENT_COLOR_OPTIONS: readonly AccentColorOption[] = [
  { value: 'pink', labelKey: 'settings.accent_pink', swatch: '#fb7299' },
  { value: 'blue', labelKey: 'settings.accent_blue', swatch: '#00aeec' },
  {
    value: 'red',
    labelKey: 'settings.accent_red',
    swatch: 'oklch(57.7% 0.245 27.325)',
  },
  {
    value: 'orange',
    labelKey: 'settings.accent_orange',
    swatch: 'oklch(64.6% 0.222 41.116)',
  },
  {
    value: 'amber',
    labelKey: 'settings.accent_amber',
    swatch: 'oklch(66.6% 0.179 58.318)',
  },
  {
    value: 'yellow',
    labelKey: 'settings.accent_yellow',
    swatch: 'oklch(68.1% 0.162 75.834)',
  },
  {
    value: 'lime',
    labelKey: 'settings.accent_lime',
    swatch: 'oklch(64.8% 0.2 131.684)',
  },
  {
    value: 'green',
    labelKey: 'settings.accent_green',
    swatch: 'oklch(62.7% 0.194 149.214)',
  },
  {
    value: 'emerald',
    labelKey: 'settings.accent_emerald',
    swatch: 'oklch(59.6% 0.145 163.225)',
  },
  {
    value: 'teal',
    labelKey: 'settings.accent_teal',
    swatch: 'oklch(60% 0.118 184.704)',
  },
  {
    value: 'cyan',
    labelKey: 'settings.accent_cyan',
    swatch: 'oklch(60.9% 0.126 221.723)',
  },
  {
    value: 'sky',
    labelKey: 'settings.accent_sky',
    swatch: 'oklch(58.8% 0.158 241.966)',
  },
  {
    value: 'indigo',
    labelKey: 'settings.accent_indigo',
    swatch: 'oklch(51.1% 0.262 276.966)',
  },
  {
    value: 'violet',
    labelKey: 'settings.accent_violet',
    swatch: 'oklch(54.1% 0.281 293.009)',
  },
  {
    value: 'purple',
    labelKey: 'settings.accent_purple',
    swatch: 'oklch(55.8% 0.288 302.321)',
  },
  {
    value: 'fuchsia',
    labelKey: 'settings.accent_fuchsia',
    swatch: 'oklch(59.1% 0.293 322.896)',
  },
  {
    value: 'rose',
    labelKey: 'settings.accent_rose',
    swatch: 'oklch(58.6% 0.253 17.585)',
  },
  {
    value: 'slate',
    labelKey: 'settings.accent_slate',
    swatch: 'oklch(44.6% 0.043 257.281)',
  },
  {
    value: 'gray',
    labelKey: 'settings.accent_gray',
    swatch: 'oklch(44.6% 0.03 256.802)',
  },
  {
    value: 'zinc',
    labelKey: 'settings.accent_zinc',
    swatch: 'oklch(44.2% 0.017 285.786)',
  },
  {
    value: 'neutral',
    labelKey: 'settings.accent_neutral',
    swatch: 'oklch(43.9% 0 none)',
  },
  {
    value: 'stone',
    labelKey: 'settings.accent_stone',
    swatch: 'oklch(44.4% 0.011 73.639)',
  },
  {
    value: 'mauve',
    labelKey: 'settings.accent_mauve',
    swatch: 'oklch(43.5% 0.029 321.78)',
  },
  {
    value: 'olive',
    labelKey: 'settings.accent_olive',
    swatch: 'oklch(46.6% 0.025 107.3)',
  },
  {
    value: 'mist',
    labelKey: 'settings.accent_mist',
    swatch: 'oklch(45% 0.017 213.2)',
  },
  {
    value: 'taupe',
    labelKey: 'settings.accent_taupe',
    swatch: 'oklch(43.8% 0.017 39.3)',
  },
]
