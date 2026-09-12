/**
 * settingsSlice suite. The setSettings merge (issue #563 field patches)
 * against the real singleton store: patched fields land, untouched fields
 * survive.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { setSettings } from './settingsSlice'

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
        autoRenameDuplicates: false,
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
    expect(s.autoRenameDuplicates).toBe(false)
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
})
