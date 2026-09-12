import type { User } from '@/features/user'

import type { LoginMethod, Session } from './api/loginApi'

/**
 * Returns the login status display text key based on session, method, and
 * the live user state from the Bilibili API.
 *
 * Firefox logins never populate `session` (no encrypted session file is
 * written), so we fall back to the user info fetched from the nav API to
 * decide whether the user is actually logged in.
 *
 * @param session - Stored session payload, or `null` when no session is
 *   stored. Ignored for the Firefox method.
 * @param loginMethod - The currently selected login method.
 * @param user - The user object from Redux, used to detect whether the
 *   Firefox cookie actually authenticates the user.
 * @returns An i18n key (`login.qrCodeLoggedIn`, `login.firefoxCookieLoggedIn`,
 *   `login.manualCookieLoggedIn`, `login.session_expired`, or
 *   `login.notLoggedIn`) suitable for `t()`.
 */
export function getLoginStatusText(
  session: Session | null,
  loginMethod: LoginMethod,
  user: User,
): string {
  if (loginMethod === 'firefox') {
    return user.hasCookie && user.data.isLogin
      ? 'login.firefoxCookieLoggedIn'
      : 'login.notLoggedIn'
  }
  if (session === null) return 'login.notLoggedIn'
  // Session-backed methods (QR / manual) with a stored session: the file
  // existing does not guarantee the cookies are still valid (e.g. refresh
  // failed, wind-control issued an empty SESSDATA, pasted cookie expired).
  // Check the live user state as well so the Settings UI stays consistent
  // with the AppBar, which is driven by the nav API.
  if (!user.hasCookie || !user.data.isLogin) {
    return 'login.session_expired'
  }
  return loginMethod === 'manual'
    ? 'login.manualCookieLoggedIn'
    : 'login.qrCodeLoggedIn'
}

/**
 * Converts Session to User type for userSlice.
 *
 * When `session` is `null`, returns a minimal logged-out `User` object so
 * the rest of the UI can treat the two sources uniformly. The `mid` field
 * is parsed from `dedeUserId` and left `undefined` when the value is not a
 * valid integer, matching the shape returned by the user-info API.
 *
 * @param session - Session data from login state, or `null` for logged-out.
 * @returns User object compatible with userSlice.
 */
export function sessionToUser(session: Session | null): User {
  if (!session) {
    return {
      code: 0,
      message: '',
      ttl: 0,
      data: {
        uname: '',
        isLogin: false,
        wbiImg: {
          imgUrl: '',
          subUrl: '',
        },
      },
      hasCookie: false,
    }
  }
  return {
    code: 0,
    message: '',
    ttl: 0,
    data: {
      mid: parseInt(session.dedeUserId, 10) || undefined,
      uname: session.uname,
      isLogin: true,
      wbiImg: {
        imgUrl: '',
        subUrl: '',
      },
    },
    hasCookie: true,
  }
}
