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

  /**
   * Fetches the current user info from the Bilibili API and
   * updates the Redux store. Re-throws the error after
   * intercepting it so callers can still handle failures.
   *
   * @returns The fetched {@link User} object
   * @throws The original error if the API call fails
   */
  async function getUserInfo(): Promise<User> {
    try {
      const res = await fetchUser()
      store.dispatch(setUser(res))
      return res
    } catch (err) {
      await interceptInvokeError(store, err)
      throw err
    }
  }

  /**
   * Replaces the current user state in Redux with the given object.
   *
   * @param user - The new {@link User} state to dispatch
   */
  function onChangeUser(user: User): void {
    store.dispatch(setUser(user))
  }

  return {
    user,
    onChangeUser,
    getUserInfo,
  }
}
