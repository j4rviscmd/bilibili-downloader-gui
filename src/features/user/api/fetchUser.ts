import type { User } from '@/features/user/types'
import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches user information from Bilibili.
 *
 * Invokes the 'fetch_user' Tauri command to retrieve the authenticated
 * user's information from Bilibili using stored cookies. Returns null
 * if the user is not logged in or if the request fails.
 *
 * @returns A promise resolving to the user object or null if unavailable
 *
 * @example
 * ```typescript
 * const user = await fetchUser()
 * if (user?.data.isLogin) {
 *   console.log('Logged in as:', user.data.uname)
 * }
 * ```
 */
export const fetchUser = async (): Promise<User | null> => {
  const user = await invoke<User | null>('fetch_user')

  return user
}
