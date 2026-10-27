/**
 * Page registry invariants (the former PAGES/PAGE_PATHS parity guard).
 *
 * The registry is the single source for the layout mount table, the
 * sidebar nav, and the Settings startup/visibility lists — these tests
 * pin the structural promises every consumer relies on.
 */
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, PAGE_DEFS, PAGE_PATHS, pageKey } from './pages'

describe('page registry', () => {
  it('exposes every route exactly once, in registry order', () => {
    const paths = PAGE_DEFS.flatMap((def) =>
      def.routes.map((route) => route.path),
    )
    expect(new Set(paths).size).toBe(paths.length)
    expect([...PAGE_PATHS]).toEqual(paths)
  })

  it('pins the required (never hideable) pages', () => {
    // Regression guard: making a core download-flow page hideable would
    // let users lock themselves out of the app's main purpose.
    expect(
      PAGE_DEFS.filter((def) => def.required)
        .map(pageKey)
        .sort(),
    ).toEqual(['/downloads', '/search', '/settings'])
  })

  it('gives every nav item complete metadata', () => {
    for (const def of PAGE_DEFS) {
      if (!def.groupId) continue
      expect(def.icon, pageKey(def)).toBeDefined()
      expect(def.ariaKey, pageKey(def)).toBeDefined()
      expect(NAV_GROUPS.map((g) => g.id)).toContain(def.groupId)
    }
    // /settings is the footer entry — never a sidebar group item.
    const settingsDef = PAGE_DEFS.find((def) => pageKey(def) === '/settings')!
    expect(settingsDef.groupId).toBeUndefined()
  })

  it('keeps secondary routes owned by a required-safe primary', () => {
    // The 動画検索 feature owns /popular + /video-search: hiding the
    // feature must disable both routes, and the sidebar item stays
    // active on either one.
    const videoSearch = PAGE_DEFS.find((def) => pageKey(def) === '/popular')!
    expect(videoSearch.routes.map((r) => r.path)).toEqual([
      '/popular',
      '/video-search',
    ])
  })
})
