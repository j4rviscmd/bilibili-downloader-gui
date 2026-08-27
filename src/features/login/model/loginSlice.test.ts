/**
 * loginSlice unit suite.
 *
 * Dispatches against the real singleton store and asserts on
 * `store.getState().login`. resetLogin restores the initial state in
 * beforeEach.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import type { QrCodeStatus, Session } from '../api/loginApi'
import {
  clearQrCode,
  resetLogin,
  setError,
  setLoginMethod,
  setQrCode,
  setQrLoading,
  setQrStatus,
  setSession,
} from './loginSlice'

const initialState = {
  qrStatus: null,
  qrCodeImage: null,
  qrcodeKey: null,
  statusMessage: '',
  loginMethod: 'firefox',
  session: null,
  isQrLoading: false,
  error: null,
}

const session: Session = {
  sessdata: 'sess-data',
  biliJct: 'bili-jct',
  dedeUserId: '42',
  dedeUserIdCkMd5: 'md5',
  refreshToken: 'refresh',
  timestamp: 1_700_000_000_000,
  uname: 'tester',
}

function login() {
  return store.getState().login
}

beforeEach(() => {
  store.dispatch(resetLogin())
})

describe('setQrCode', () => {
  it('stores image/key and resets poll state to a clean waitingForScan', () => {
    // A regenerated QR must not show the previous poll's message/error.
    store.dispatch(setQrStatus({ status: 'expired', message: 'expired!' }))
    store.dispatch(setError('old error'))
    store.dispatch(setQrLoading(true))

    store.dispatch(setQrCode({ image: 'data:image/png;base64,abc', key: 'k1' }))

    expect(login()).toMatchObject({
      qrCodeImage: 'data:image/png;base64,abc',
      qrcodeKey: 'k1',
      qrStatus: 'waitingForScan',
      statusMessage: '',
      error: null,
    })
    // setQrCode deliberately leaves isQrLoading alone — only clearQrCode
    // and setError reset it.
    expect(login().isQrLoading).toBe(true)
  })
})

describe('setQrStatus', () => {
  // Typed const instead of an angle-bracket assertion (erasableSyntaxOnly).
  const rows: [QrCodeStatus, string][] = [
    ['scannedWaitingConfirm', 'confirm on your phone'],
    ['success', 'logged in'],
    ['expired', 'QR code expired'],
    ['error', 'poll failed'],
  ]

  it.each(rows)('stores status %s with its message', (status, message) => {
    store.dispatch(setQrStatus({ status, message }))
    expect(login()).toMatchObject({ qrStatus: status, statusMessage: message })
  })
})

describe('setLoginMethod / setSession / setQrLoading', () => {
  it('switches the preferred login method', () => {
    store.dispatch(setLoginMethod('qrCode'))
    expect(login().loginMethod).toBe('qrCode')
  })

  it('stores and clears the session without touching qrStatus', () => {
    store.dispatch(setQrStatus({ status: 'success', message: 'ok' }))
    store.dispatch(setSession(session))
    expect(login().session).toEqual(session)
    expect(login().qrStatus).toBe('success')

    store.dispatch(setSession(null))
    expect(login().session).toBeNull()
  })

  it('tracks QR loading state', () => {
    store.dispatch(setQrLoading(true))
    expect(login().isQrLoading).toBe(true)
  })
})

describe('setError', () => {
  it('sets the error and resets the QR loading spinner', () => {
    store.dispatch(setQrLoading(true))
    store.dispatch(setError('QR generation failed'))
    expect(login()).toMatchObject({
      error: 'QR generation failed',
      isQrLoading: false,
    })
  })
})

describe('clearQrCode', () => {
  it('clears QR/session state but preserves the chosen login method', () => {
    store.dispatch(setLoginMethod('qrCode'))
    store.dispatch(setQrCode({ image: 'data:image/png;base64,abc', key: 'k1' }))
    store.dispatch(
      setQrStatus({ status: 'scannedWaitingConfirm', message: 'confirm' }),
    )
    store.dispatch(setQrLoading(true))
    store.dispatch(setSession(session))

    store.dispatch(clearQrCode())

    expect(login()).toEqual({ ...initialState, loginMethod: 'qrCode' })
  })
})
