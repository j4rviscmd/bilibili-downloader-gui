/**
 * settingsSlice suite. The setSettings merge (issue #563 field patches)
 * against the real singleton store: patched fields land, untouched fields
 * survive.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { setSettings, settingsSlice } from './settingsSlice'

function settings() {
  return store.getState().settings
}

beforeEach(() => {
  store.dispatch(setSettings({ dlOutputPath: '', language: 'en' }))
})

describe('settingsSlice', () => {
  it('merges a full settings object into the state', () => {
    store.dispatch(setSettings({ dlOutputPath: '/old' }))

    store.dispatch(
      setSettings({
        dlOutputPath: '/new',
        language: 'ja',
        showGithubStars: false,
        fontSize: 18,
        trimMode: 'reencode',
        audioFormat: 'm4a',
        theme: 'dark',
        showTaskbarProgress: false,
        flashTaskbarOnComplete: false,
        videoCodecPriority: 'avcOnly',
        downloadParallelism: 4,
      }),
    )

    const s = settings()
    expect(s.dlOutputPath).toBe('/new')
    expect(s.language).toBe('ja')
    expect(s.downloadParallelism).toBe(4)
  })

  it('merges a partial patch (issue #563) keeping untouched fields', () => {
    // Save paths dispatch single-field patches; the reducer must
    // shallow-merge them instead of replacing the whole state.
    store.dispatch(setSettings({ dlOutputPath: '/downloads', language: 'ja' }))

    store.dispatch(setSettings({ fontSize: 16 }))

    expect(settings().fontSize).toBe(16)
    expect(settings().language).toBe('ja')
    expect(settings().dlOutputPath).toBe('/downloads')
  })

  it('defaults startupPage to /popular', () => {
    // Fresh installs: IndexPage redirects here before the persisted
    // settings arrive, and its unknown-value fallback mirrors this
    // default — a regression to another page would ship silently.
    expect(settingsSlice.getInitialState().startupPage).toBe('/popular')
  })

  it('defaults maxConcurrentDownloads to 2 and merges field patches', () => {
    // Must match the runner's fallback (runner.ts CAP_FALLBACK) so the
    // toggle group and the effective slot count agree before the
    // persisted settings arrive.
    expect(settingsSlice.getInitialState().maxConcurrentDownloads).toBe(2)

    store.dispatch(setSettings({ maxConcurrentDownloads: 4 }))

    expect(settings().maxConcurrentDownloads).toBe(4)
    expect(settings().language).toBe('en')
  })

  it('defaults defaultSubtitleMode to off and merges field patches', () => {
    // Fresh state: legacy settings without the key behave as subtitles-off.
    expect(settingsSlice.getInitialState().defaultSubtitleMode).toBe('off')

    store.dispatch(setSettings({ defaultSubtitleMode: 'soft' }))

    expect(settings().defaultSubtitleMode).toBe('soft')
    // Field patch must not wipe untouched fields.
    expect(settings().language).toBe('en')
  })
})
