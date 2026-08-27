/**
 * initSlice minimal roundtrip suite.
 *
 * The slice is two plain setters, so coverage is a set/restore roundtrip
 * against the real singleton store.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import { setInitiated, setProcessingFnc } from './initSlice'

const initialState = { initiated: false, processingFnc: '' }

function initState() {
  return store.getState().init
}

describe('initSlice', () => {
  beforeEach(() => {
    store.dispatch(setInitiated(false))
    store.dispatch(setProcessingFnc(''))
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
})
