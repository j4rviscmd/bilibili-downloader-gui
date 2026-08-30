/**
 * useLogin suite.
 *
 * Drives the real hook against mockInvoke with fake timers: QR generation,
 * recursive polling, success session capture, expiry timeout, error paths,
 * logout, and login-method switching.
 */

import { store } from '@/app/store'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QrPollResult, Session } from '../api/loginApi'
import { resetLogin, setSession } from './loginSlice'
import { useLogin } from './useLogin'

const session: Session = {
  sessdata: 'sess',
  biliJct: 'jct',
  dedeUserId: '1',
  dedeUserIdCkMd5: 'md5',
  refreshToken: 'rt',
  timestamp: 1,
  uname: 'user',
}

const QR = { qrCodeImage: 'data:image/png;base64,qr', qrcodeKey: 'key-1' }

/** Statuses returned by successive poll_qr_status calls (cycled). */
let pollScript: QrPollResult[] = []

function pollOf(status: QrPollResult['status']): QrPollResult {
  return { status, message: `msg-${status}`, session: null }
}

beforeEach(() => {
  vi.useFakeTimers()
  store.dispatch(resetLogin())
  pollScript = []
  mockInvoke.mockClear()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'generate_qr_code') return Promise.resolve(QR)
    if (cmd === 'poll_qr_status') {
      const next = pollScript.length > 1 ? pollScript.shift() : pollScript[0]
      return Promise.resolve(next)
    }
    if (cmd === 'get_login_state')
      return Promise.resolve({ method: 'qrCode', session })
    if (cmd === 'qr_logout') return Promise.resolve(undefined)
    if (cmd === 'set_login_method') return Promise.resolve(undefined)
    return Promise.resolve(undefined)
  })
})

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
})

/** Generates a QR code and awaits the first poll round. */
async function generate(hook: {
  result: { current: ReturnType<typeof useLogin> }
}) {
  await act(async () => {
    await hook.result.current.generateNewQrCode()
  })
}

function pollCalls() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === 'poll_qr_status')
}

describe('useLogin QR lifecycle', () => {
  it('stores the QR code and polls while waiting for a scan', async () => {
    pollScript = [pollOf('waitingForScan'), pollOf('scannedWaitingConfirm')]
    const hook = renderHookWithStore(() => useLogin())

    await generate(hook)

    const state = store.getState().login
    expect(state.qrCodeImage).toBe(QR.qrCodeImage)
    expect(state.qrcodeKey).toBe(QR.qrcodeKey)
    expect(state.qrStatus).toBe('waitingForScan')
    expect(mockInvoke).toHaveBeenCalledWith('poll_qr_status', {
      qrcodeKey: 'key-1',
    })

    // Next poll is scheduled only after POLL_INTERVAL_MS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(store.getState().login.qrStatus).toBe('scannedWaitingConfirm')
    expect(pollCalls()).toHaveLength(2)
  })

  it('captures the session and method on success and stops polling', async () => {
    pollScript = [pollOf('waitingForScan'), pollOf('success')]
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    const state = store.getState().login
    expect(state.qrStatus).toBe('success')
    // getLoginState syncs the persisted method and the session.
    expect(state.loginMethod).toBe('qrCode')
    expect(state.session).toEqual(session)

    // Polling stopped: advancing the interval must not trigger another poll.
    const calls = pollCalls().length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(pollCalls()).toHaveLength(calls)
  })

  it('stops polling without a session when the QR expires via the API', async () => {
    pollScript = [pollOf('expired')]
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    expect(store.getState().login.qrStatus).toBe('expired')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(pollCalls()).toHaveLength(1)
  })

  it('expires after the 180s timeout when the API keeps returning waiting', async () => {
    pollScript = [pollOf('waitingForScan')]
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000)
    })

    expect(store.getState().login.qrStatus).toBe('expired')
    expect(store.getState().login.statusMessage).toBe('QR code expired')
    const calls = pollCalls().length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(pollCalls()).toHaveLength(calls)
  })

  it('records the poll error and stops polling', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'generate_qr_code') return Promise.resolve(QR)
      return Promise.reject(new Error('ERR::QR_POLL_FAILED'))
    })
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    expect(store.getState().login.error).toBe('ERR::QR_POLL_FAILED')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(pollCalls()).toHaveLength(1)
  })

  it('falls back to a generic message when generation throws a non-Error', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'generate_qr_code') return Promise.reject('boom')
      return Promise.resolve(undefined)
    })
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    expect(store.getState().login.error).toBe('Failed to generate QR code')
    expect(store.getState().login.isQrLoading).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'poll_qr_status',
      expect.anything(),
    )
  })
})

describe('useLogin actions', () => {
  it('logout clears the session', async () => {
    const hook = renderHookWithStore(() => useLogin())
    store.dispatch(setSession(session))

    await act(async () => {
      await hook.result.current.logout()
    })

    expect(mockInvoke).toHaveBeenCalledWith('qr_logout')
    expect(store.getState().login.session).toBeNull()
  })

  it('logout failure records the error message', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'qr_logout') return Promise.reject(new Error('ERR::LOGOUT'))
      return Promise.resolve(undefined)
    })
    const hook = renderHookWithStore(() => useLogin())

    await act(async () => {
      await hook.result.current.logout()
    })

    expect(store.getState().login.error).toBe('ERR::LOGOUT')
  })

  it('changeLoginMethod persists and mirrors the method', async () => {
    const hook = renderHookWithStore(() => useLogin())

    await act(async () => {
      await hook.result.current.changeLoginMethod('qrCode')
    })

    expect(mockInvoke).toHaveBeenCalledWith('set_login_method', {
      method: 'qrCode',
    })
    expect(store.getState().login.loginMethod).toBe('qrCode')
  })

  it('changeLoginMethod failure falls back to the generic message', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'set_login_method') return Promise.reject('nope')
      return Promise.resolve(undefined)
    })
    const hook = renderHookWithStore(() => useLogin())

    await act(async () => {
      await hook.result.current.changeLoginMethod('firefox')
    })

    expect(store.getState().login.error).toBe('Failed to change login method')
  })

  it('resetLogin returns the slice to its initial state', async () => {
    const hook = renderHookWithStore(() => useLogin())
    await generate(hook)

    act(() => {
      hook.result.current.resetLogin()
    })

    expect(store.getState().login).toMatchObject({
      qrStatus: null,
      qrCodeImage: null,
      qrcodeKey: null,
      loginMethod: 'firefox',
      session: null,
    })
  })
})
