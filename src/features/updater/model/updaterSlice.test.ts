/**
 * updaterSlice unit suite.
 *
 * Dispatches against the real singleton store and asserts on
 * `store.getState().updater`. resetUpdater restores the initial state
 * in beforeEach.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  resetUpdater,
  setDownloadProgress,
  setError,
  setIsDownloading,
  setIsUpdateReady,
  setReleaseNotes,
  setShowDialog,
  setUpdateAvailable,
} from './updaterSlice'

const initialState = {
  updateAvailable: false,
  latestVersion: null,
  currentVersion: null,
  releaseNotes: null,
  downloadProgress: 0,
  isDownloading: false,
  isUpdateReady: false,
  error: null,
  showDialog: false,
}

function updater() {
  return store.getState().updater
}

beforeEach(() => {
  store.dispatch(resetUpdater())
})

describe('setUpdateAvailable', () => {
  it('shows the dialog only when an update is available', () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: 'v1.2.1',
        currentVersion: 'v1.2.0',
      }),
    )
    expect(updater()).toMatchObject({
      updateAvailable: true,
      latestVersion: 'v1.2.1',
      currentVersion: 'v1.2.0',
      showDialog: true,
    })

    store.dispatch(
      setUpdateAvailable({
        available: false,
        latestVersion: null,
        currentVersion: 'v1.2.0',
      }),
    )
    expect(updater()).toMatchObject({
      updateAvailable: false,
      showDialog: false,
    })
  })
})

describe('update lifecycle setters', () => {
  it('tracks download progress and flags', () => {
    store.dispatch(setIsDownloading(true))
    store.dispatch(setDownloadProgress(42.5))
    expect(updater()).toMatchObject({
      isDownloading: true,
      downloadProgress: 42.5,
    })

    store.dispatch(setIsDownloading(false))
    store.dispatch(setIsUpdateReady(true))
    expect(updater()).toMatchObject({
      isDownloading: false,
      isUpdateReady: true,
    })
  })

  it('stores release notes and error independently', () => {
    store.dispatch(setReleaseNotes('# Changelog'))
    expect(updater().releaseNotes).toBe('# Changelog')

    store.dispatch(setError('network unreachable'))
    expect(updater().error).toBe('network unreachable')

    store.dispatch(setError(null))
    expect(updater().error).toBeNull()
  })

  it('setShowDialog controls visibility without touching availability', () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: 'v1.2.1',
        currentVersion: 'v1.2.0',
      }),
    )
    store.dispatch(setShowDialog(false))

    expect(updater()).toMatchObject({
      showDialog: false,
      updateAvailable: true,
    })
  })
})

describe('resetUpdater', () => {
  it('restores the initial state after a full update flow', () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: 'v1.2.1',
        currentVersion: 'v1.2.0',
      }),
    )
    store.dispatch(setReleaseNotes('# Changelog'))
    store.dispatch(setIsDownloading(true))
    store.dispatch(setDownloadProgress(99))
    store.dispatch(setError('boom'))
    store.dispatch(resetUpdater())

    expect(updater()).toEqual(initialState)
  })
})
