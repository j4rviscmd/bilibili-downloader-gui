import type { User } from '@/features/user'
import { describe, expect, it } from 'vitest'
import type { Session } from './api/loginApi'
import { getLoginStatusText, sessionToUser } from './loginStatus'

const loggedInUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: {
    mid: 7,
    uname: 'u',
    isLogin: true,
    wbiImg: { imgUrl: '', subUrl: '' },
  },
  hasCookie: true,
}

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const session: Session = {
  sessdata: 'sess',
  biliJct: 'jct',
  dedeUserId: '42',
  dedeUserIdCkMd5: 'md5',
  refreshToken: 'rt',
  timestamp: 1,
  uname: 'qr-user',
}

describe('getLoginStatusText', () => {
  it('derives firefox status from the live user state, ignoring the session', () => {
    expect(getLoginStatusText(session, 'firefox', loggedInUser)).toBe(
      'login.firefoxCookieLoggedIn',
    )
    expect(getLoginStatusText(session, 'firefox', loggedOutUser)).toBe(
      'login.notLoggedIn',
    )
  })

  it('reports not-logged-in when a session-backed method has no session', () => {
    expect(getLoginStatusText(null, 'qrCode', loggedOutUser)).toBe(
      'login.notLoggedIn',
    )
    expect(getLoginStatusText(null, 'manual', loggedOutUser)).toBe(
      'login.notLoggedIn',
    )
  })

  it('reports session_expired when a stored session fails the live check', () => {
    expect(getLoginStatusText(session, 'qrCode', loggedOutUser)).toBe(
      'login.session_expired',
    )
    expect(getLoginStatusText(session, 'manual', loggedOutUser)).toBe(
      'login.session_expired',
    )
  })

  it('reports the per-method logged-in key when the live check passes', () => {
    expect(getLoginStatusText(session, 'qrCode', loggedInUser)).toBe(
      'login.qrCodeLoggedIn',
    )
    expect(getLoginStatusText(session, 'manual', loggedInUser)).toBe(
      'login.manualCookieLoggedIn',
    )
  })
})

describe('sessionToUser', () => {
  it('returns a minimal logged-out user for null', () => {
    const user = sessionToUser(null)

    expect(user.hasCookie).toBe(false)
    expect(user.data.isLogin).toBe(false)
    expect(user.data.mid).toBeUndefined()
  })

  it('maps the session fields onto the user shape', () => {
    const user = sessionToUser(session)

    expect(user.hasCookie).toBe(true)
    expect(user.data.isLogin).toBe(true)
    expect(user.data.mid).toBe(42)
    expect(user.data.uname).toBe('qr-user')
  })

  it('leaves mid undefined for a non-numeric dedeUserId', () => {
    expect(
      sessionToUser({ ...session, dedeUserId: 'not-a-number' }).data.mid,
    ).toBeUndefined()
  })
})
