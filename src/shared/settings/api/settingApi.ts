import type { Settings } from '@/shared/settings/type'
import { invoke } from '@tauri-apps/api/core'

export const callGetSettings = async () => {
  const res = await invoke<Settings>('get_settings')

  return res
}

export const callSetSettings = async (settings: Settings) => {
  const res = await invoke('set_settings', { settings })

  return res
}
