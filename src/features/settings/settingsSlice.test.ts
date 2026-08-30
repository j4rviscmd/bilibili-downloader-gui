/**
 * settingsSlice suite. Three reducers against the real singleton store:
 * path update, dialog toggle, and the setSettings merge that preserves
 * dialogOpen.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { setDLOutputPath, setOpenDialog, setSettings } from './settingsSlice'

function settings() {
  return store.getState().settings
}

beforeEach(() => {
  store.dispatch(setOpenDialog(false))
  store.dispatch(setDLOutputPath(''))
})

describe('settingsSlice', () => {
  it('updates the download output path', () => {
    store.dispatch(setDLOutputPath('/downloads'))

    expect(settings().dlOutputPath).toBe('/downloads')
  })

  it('toggles the settings dialog', () => {
    store.dispatch(setOpenDialog(true))
    expect(settings().dialogOpen).toBe(true)

    store.dispatch(setOpenDialog(false))
    expect(settings().dialogOpen).toBe(false)
  })

  it('merges a full settings object into the state', () => {
    store.dispatch(setOpenDialog(true))
    store.dispatch(setDLOutputPath('/old'))

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
    // setSettings preserves UI-only state that the backend object lacks.
    expect(s.dialogOpen).toBe(true)
  })
})
