/**
 * Locale key-parity test.
 *
 * Replaces the manual bash loop documented in CLAUDE.md ("for f in
 * src/i18n/locales/*.json; do grep -c ..."). That check only compared
 * key COUNTS, so a locale could pass with a renamed key while missing
 * another. This test compares the full key SET against en and reports
 * the exact missing/extra keys per language.
 */

import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

const locales: Record<string, object> = { ja, zh, ko, es, fr }

/** Flattens nested JSON into dotted key paths ("video.part.select"). */
function flatKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

const baseKeys = new Set(flatKeys(en))

describe('locale key parity', () => {
  it.each(Object.keys(locales))(
    '%s.json has the same keys as en.json',
    (lang) => {
      const targetKeys = new Set(flatKeys(locales[lang]))
      const missing = [...baseKeys].filter((k) => !targetKeys.has(k))
      const extra = [...targetKeys].filter((k) => !baseKeys.has(k))

      expect(
        { missing, extra },
        `${lang}.json is out of sync with en.json — missing keys must be added ` +
          `to all 6 languages (see CLAUDE.md i18n rule)`,
      ).toEqual({ missing: [], extra: [] })
    },
  )

  it('every locale file on disk is covered by this suite', () => {
    // Guard the guard: enumerate from the filesystem so a future locale
    // file that someone forgets to register in `locales` above FAILS here
    // instead of silently skipping parity.
    const onDisk = Object.keys(import.meta.glob('./locales/*.json'))
      .map((p) => p.match(/\.\/locales\/(.*)\.json$/)![1])
      .filter((name) => name !== 'en')
      .sort()
    expect(onDisk).toEqual(Object.keys(locales).sort())
  })
})
