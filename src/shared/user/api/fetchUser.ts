import type { User } from '@/shared/user/types'
import { invoke } from '@tauri-apps/api/core'

export const fetchUser = async (): Promise<User | null> => {
  const user = await invoke<User | null>('fetch_user')

  return user
}
