import loginReducer, {
  clearQrCode,
  setQrCode,
  setSession,
} from './loginSlice'
import type { Session } from '../api/loginApi'
import { describe, expect, it } from 'vitest'

const session: Session = {
  sessdata: 'sd',
  biliJct: 'jct',
  dedeUserId: '42',
  dedeUserIdCkMd5: 'md5',
  refreshToken: 'rt',
  timestamp: 1,
  uname: 'tester',
}

describe('loginSlice', () => {
  it('clearQrCode does not wipe an existing session', () => {
    let state = loginReducer(undefined, setQrCode({ image: 'data:', key: 'k' }))
    state = loginReducer(state, setSession(session))

    const cleared = loginReducer(state, clearQrCode())

    expect(cleared.qrCodeImage).toBeNull()
    expect(cleared.qrStatus).toBeNull()
    expect(cleared.session).toEqual(session)
    expect(cleared.loginMethod).toBe(state.loginMethod)
  })
})
