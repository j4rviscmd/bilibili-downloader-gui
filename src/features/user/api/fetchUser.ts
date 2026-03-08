import type { User } from '@/features/user/types'
import { logger } from '@/shared/lib/logger'
import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches user information from Bilibili.
 *
 * Invokes the 'fetch_user' Tauri command to retrieve the authenticated
 * user's information from Bilibili using stored cookies. Returns a User
 * object with `has_cookie` indicating whether valid cookies are available.
 *
 * @returns A promise resolving to the user object
 *
 * @example
 * ```typescript
 * const user = await fetchUser()
 * if (user.hasCookie && user.data.isLogin) {
 *   console.log('Logged in as:', user.data.uname)
 * }
 * ```
 */
export const fetchUser = async (): Promise<User> => {
  logger.info('fetchUser: Fetching user info')
  try {
    const result = await invoke<User>('fetch_user')
    logger.debug(
      `fetchUser: hasCookie=${result.hasCookie}, isLogin=${result.data.isLogin}`,
    )
    return result
  } catch (error) {
    logger.error('fetchUser: Failed to fetch user info', error)
    throw error
  }
}
