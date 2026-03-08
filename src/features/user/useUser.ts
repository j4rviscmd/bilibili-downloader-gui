import { interceptInvokeError } from '@/app/lib/invokeErrorHandler'
import { store, useSelector } from '@/app/store'
import { fetchUser } from '@/features/user/api/fetchUser'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'

/**
 * Hook for managing user authentication state.
 *
 * Provides access to the current user information and methods to
 * fetch and update it. The user data includes login status, username,
 * and cookie availability status.
 *
 * @returns User state and mutation methods
 *
 * @example
 * ```typescript
 * const { user, getUserInfo } = useUser()
 *
 * // Fetch user info
 * const userData = await getUserInfo()
 * if (userData.hasCookie && userData.data.isLogin) {
 *   console.log('User:', userData.data.uname)
 * }
 * ```
 */
export function useUser() {
  const user = useSelector((state) => state.user)

  async function getUserInfo(): Promise<User> {
    try {
      const res = await fetchUser()
      store.dispatch(setUser(res))
      return res
    } catch (err) {
      interceptInvokeError(store, err)
      throw err
    }
  }

  function onChangeUser(user: User): void {
    store.dispatch(setUser(user))
  }

  return {
    user,
    onChangeUser,
    getUserInfo,
  }
}
