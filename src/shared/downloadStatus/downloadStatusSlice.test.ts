/**
 * downloadStatusSlice suite.
 *
 * Pure reducer tests: the slice is intentionally NOT registered in the app
 * store, so the reducer is exercised directly without dispatching.
 */

import { describe, expect, it } from 'vitest'

import reducer, {
  clearError,
  setError,
  type DownloadStatusState,
} from './downloadStatusSlice'

describe('downloadStatusSlice', () => {
  it('starts without an error', () => {
    expect(reducer(undefined, { type: 'unknown' })).toEqual({
      hasError: false,
      errorMessage: undefined,
    })
  })

  it('setError records the message', () => {
    const state: DownloadStatusState = { hasError: false }

    expect(reducer(state, setError('ERR::DOWNLOAD_FAILED'))).toEqual({
      hasError: true,
      errorMessage: 'ERR::DOWNLOAD_FAILED',
    })
  })

  it('setError replaces a previous error', () => {
    const state: DownloadStatusState = {
      hasError: true,
      errorMessage: 'old',
    }

    expect(reducer(state, setError('new'))).toEqual({
      hasError: true,
      errorMessage: 'new',
    })
  })

  it('clearError resets both fields', () => {
    const state: DownloadStatusState = {
      hasError: true,
      errorMessage: 'ERR::DOWNLOAD_FAILED',
    }

    expect(reducer(state, clearError())).toEqual({
      hasError: false,
      errorMessage: undefined,
    })
  })
})
