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
export const useUser = () => {
  const user = useSelector((state) => state.user)

  /**
   * Updates the user state in Redux.
   *
   * @param user - The new user object
   */
  const onChangeUser = (user: User) => {
    store.dispatch(setUser(user))
  }

  /**
   * Fetches user information from Bilibili and updates Redux state.
   *
   * @returns The fetched user object
   */
  const getUserInfo = async (): Promise<User> => {
    const res = await fetchUser()
    // console.log('user')
    // console.log(JSON.stringify(res, null, 2))
    onChangeUser(res)

    return res
  }

  return {
    user,
    onChangeUser,
    getUserInfo,
  }
}
