/**
 * initSlice minimal roundtrip suite.
 *
 * The slice is a set of plain setters, so coverage is a set/restore
 * roundtrip against the real singleton store.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  setFirefoxAccessDenied,
  setFirefoxPermissionDismissed,
  setInitiated,
  setProcessingFnc,
} from './initSlice'

const initialState = {
  initiated: false,
  processingFnc: '',
  firefoxAccessDenied: false,
  firefoxPermissionDismissed: false,
}

function initState() {
  return store.getState().init
}

describe('initSlice', () => {
  beforeEach(() => {
    store.dispatch(setInitiated(false))
    store.dispatch(setProcessingFnc(''))
    store.dispatch(setFirefoxAccessDenied(false))
    store.dispatch(setFirefoxPermissionDismissed(false))
  })

  it('setInitiated flips the completion flag', () => {
    store.dispatch(setInitiated(true))
    expect(initState().initiated).toBe(true)
  })

  it('setProcessingFnc updates the status message', () => {
    store.dispatch(setProcessingFnc('Checking ffmpeg...'))
    expect(initState().processingFnc).toBe('Checking ffmpeg...')
  })

  it('restores the initial state after the startup sequence', () => {
    store.dispatch(setProcessingFnc('Loading settings...'))
    store.dispatch(setInitiated(true))
    store.dispatch(setProcessingFnc(''))
    store.dispatch(setInitiated(false))

    expect(initState()).toEqual(initialState)
  })

  it('setFirefoxAccessDenied toggles the Firefox permission prompt', () => {
    store.dispatch(setFirefoxAccessDenied(true))
    expect(initState().firefoxAccessDenied).toBe(true)
  })

  it('setFirefoxPermissionDismissed hides the prompt without forgetting the denial', () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setFirefoxPermissionDismissed(true))

    expect(initState().firefoxAccessDenied).toBe(true)
    expect(initState().firefoxPermissionDismissed).toBe(true)
  })
})
