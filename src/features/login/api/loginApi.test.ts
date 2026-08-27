import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkCookieRefresh,
  generateQrCode,
  getLoginMethod,
  getLoginState,
  loadQrSession,
  pollQrStatus,
  qrLogout,
  refreshCookie,
  setLoginMethod,
} from './loginApi'

// Shared by every describe below; mockInvoke must not leak between tests.
beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateQrCode', () => {
  it('should call invoke with generate_qr_code command', async () => {
    const qr = { qrCodeImage: 'data:image/png;base64,abc', qrcodeKey: 'key1' }
    mockInvoke.mockResolvedValue(qr)

    const result = await generateQrCode()

    expect(mockInvoke).toHaveBeenCalledWith('generate_qr_code')
    expect(result).toEqual(qr)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'))

    await expect(generateQrCode()).rejects.toThrow('Network error')
  })
})

describe('pollQrStatus', () => {
  it('should call invoke with poll_qr_status command and qrcodeKey', async () => {
    const poll = {
      status: 'scannedWaitingConfirm' as const,
      message: 'Confirm on your phone',
      session: null,
    }
    mockInvoke.mockResolvedValue(poll)

    const result = await pollQrStatus('key1')

    expect(mockInvoke).toHaveBeenCalledWith('poll_qr_status', {
      qrcodeKey: 'key1',
    })
    expect(result).toEqual(poll)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Poll failed'))

    await expect(pollQrStatus('key1')).rejects.toThrow('Poll failed')
  })
})

describe('qrLogout', () => {
  it('should call invoke with qr_logout command', async () => {
    mockInvoke.mockResolvedValue(undefined)

    await qrLogout()

    expect(mockInvoke).toHaveBeenCalledWith('qr_logout')
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Logout failed'))

    await expect(qrLogout()).rejects.toThrow('Logout failed')
  })
})

describe('setLoginMethod', () => {
  it('should call invoke with set_login_method command and method', async () => {
    mockInvoke.mockResolvedValue(undefined)

    await setLoginMethod('qrCode')

    expect(mockInvoke).toHaveBeenCalledWith('set_login_method', {
      method: 'qrCode',
    })
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Persist failed'))

    await expect(setLoginMethod('firefox')).rejects.toThrow('Persist failed')
  })
})

describe('getLoginMethod', () => {
  it('should call invoke with get_login_method command', async () => {
    mockInvoke.mockResolvedValue('firefox')

    const result = await getLoginMethod()

    expect(mockInvoke).toHaveBeenCalledWith('get_login_method')
    expect(result).toBe('firefox')
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Read failed'))

    await expect(getLoginMethod()).rejects.toThrow('Read failed')
  })
})

describe('getLoginState', () => {
  it('should call invoke with get_login_state command', async () => {
    const state = {
      method: 'qrCode' as const,
      session: {
        sessdata: 'sess',
        biliJct: 'jct',
        dedeUserId: '42',
        dedeUserIdCkMd5: 'md5',
        refreshToken: 'rt',
        timestamp: 1700000000000,
        uname: 'user',
      },
    }
    mockInvoke.mockResolvedValue(state)

    const result = await getLoginState()

    expect(mockInvoke).toHaveBeenCalledWith('get_login_state')
    expect(result).toEqual(state)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('State unavailable'))

    await expect(getLoginState()).rejects.toThrow('State unavailable')
  })
})

describe('loadQrSession', () => {
  it('should call invoke with load_qr_session command and return restored flag', async () => {
    mockInvoke.mockResolvedValue(true)

    const result = await loadQrSession()

    expect(mockInvoke).toHaveBeenCalledWith('load_qr_session')
    expect(result).toBe(true)
  })

  it('should return false when no session was stored', async () => {
    mockInvoke.mockResolvedValue(false)

    await expect(loadQrSession()).resolves.toBe(false)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Keyring error'))

    await expect(loadQrSession()).rejects.toThrow('Keyring error')
  })
})

describe('checkCookieRefresh', () => {
  it('should call invoke with check_cookie_refresh command', async () => {
    const info = { refresh: true, timestamp: 1700000000000 }
    mockInvoke.mockResolvedValue(info)

    const result = await checkCookieRefresh()

    expect(mockInvoke).toHaveBeenCalledWith('check_cookie_refresh')
    expect(result).toEqual(info)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Check failed'))

    await expect(checkCookieRefresh()).rejects.toThrow('Check failed')
  })
})

describe('refreshCookie', () => {
  it('should call invoke with refresh_cookie command', async () => {
    const session = {
      sessdata: 'new-sess',
      biliJct: 'new-jct',
      dedeUserId: '42',
      dedeUserIdCkMd5: 'md5',
      refreshToken: 'new-rt',
      timestamp: 1700000000000,
      uname: 'user',
    }
    mockInvoke.mockResolvedValue(session)

    const result = await refreshCookie()

    expect(mockInvoke).toHaveBeenCalledWith('refresh_cookie')
    expect(result).toEqual(session)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Refresh token expired'))

    await expect(refreshCookie()).rejects.toThrow('Refresh token expired')
  })
})
